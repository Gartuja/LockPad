import React, { useCallback, useEffect, useRef, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import type { Language, NoteAttachment, StickyNote } from "../types";
import { NoteCard } from "./NoteCard";

interface PopoutNoteViewProps {
  noteId: string;
  isVault: boolean;
  initialTheme: "dark" | "light";
}

export const PopoutNoteView: React.FC<PopoutNoteViewProps> = ({
  noteId,
  isVault,
  initialTheme,
}) => {
  const [note, setNote] = useState<StickyNote | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">(initialTheme);
  const [lang, setLang] = useState<Language>("pt");
  const saveTimerRef = useRef<number | null>(null);
  const stealthInFlightRef = useRef(false);

  useEffect(() => {
    let unlistenSync: (() => void) | undefined;
    let unlistenTheme: (() => void) | undefined;
    let unlistenLang: (() => void) | undefined;
    let unlistenLock: (() => void) | undefined;

    (async () => {
      try {
        const store = await api.getPublicStore();
        setTheme(store.preferences.theme);
        if (store.preferences.language) setLang(store.preferences.language);
        if (isVault) {
          const manifest = await api.getVaultManifest();
          const found = manifest.notes.find((n) => n.id === noteId) ?? null;
          setNote(found);
        } else {
          const found = store.notes.find((n) => n.id === noteId) ?? null;
          setNote(found);
        }
      } catch {
        getCurrentWindow().close();
      }

      unlistenSync = await listen<{ note: StickyNote; isVault: boolean }>(
        "note-sync",
        (ev) => {
          if (ev.payload.isVault === isVault && ev.payload.note.id === noteId) {
            setNote(ev.payload.note);
          }
        }
      );

      unlistenTheme = await listen<"dark" | "light">("theme-sync", (ev) => {
        setTheme(ev.payload);
      });

      unlistenLang = await listen<Language>("lang-sync", (ev) => {
        setLang(ev.payload);
      });

      if (isVault) {
        unlistenLock = await listen("vault-auto-locked", () => {
          getCurrentWindow().close();
        });
      }
    })();

    return () => {
      if (unlistenSync) unlistenSync();
      if (unlistenTheme) unlistenTheme();
      if (unlistenLang) unlistenLang();
      if (unlistenLock) unlistenLock();
    };
  }, [noteId, isVault]);

  const handleNoteChange = useCallback(
    (updated: StickyNote) => {
      setNote(updated);
      emit("note-sync", { note: updated, isVault }).catch(() => {});

      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(async () => {
        try {
          if (isVault) {
            const manifest = await api.getVaultManifest();
            const next = manifest.notes.map((n) => (n.id === updated.id ? updated : n));
            await api.saveVaultNotes(next);
          } else {
            const store = await api.getPublicStore();
            const next = store.notes.map((n) => (n.id === updated.id ? updated : n));
            await api.savePublicNotes(next);
          }
        } catch {
          // Ignore if locked
        }
      }, 200);
    },
    [isVault]
  );

  const handleStealthCandidate = useCallback(
    async (candidate: string, onMatchedCleanup: () => void) => {
      if (isVault || stealthInFlightRef.current) return;
      stealthInFlightRef.current = true;
      try {
        const store = await api.getPublicStore();
        if (!store.preferences.stealth_trigger_enabled) return;
        const matched = await api.stealthTryUnlock(candidate);
        if (matched) {
          if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
          onMatchedCleanup();
          await emit("vault-unlocked", {});
          await api.showMainWindow();
        }
      } catch {
        // Ignore
      } finally {
        stealthInFlightRef.current = false;
      }
    },
    [isVault]
  );

  const handleTogglePin = async (updated: StickyNote) => {
    try {
      await api.setNoteWindowPinned(noteId, isVault, updated.pinned);
    } catch {
      // Ignore
    }
  };

  const handleToggleDesktopWidget = async (updated: StickyNote) => {
    try {
      await api.setNoteWindowDesktopWidget(
        noteId,
        isVault,
        Boolean(updated.desktop_widget)
      );
    } catch {
      // Ignore
    }
  };

  const handleAttachFiles = async (targetNoteId: string) => {
    try {
      const selected = await open({ multiple: true });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      if (isVault) {
        const manifest = await api.attachVaultNoteFiles(targetNoteId, paths);
        const updated = manifest.notes.find((n) => n.id === targetNoteId);
        if (updated) {
          setNote(updated);
          emit("note-sync", { note: updated, isVault: true }).catch(() => {});
        }
      } else {
        const nextNotes = await api.attachPublicFiles(targetNoteId, paths);
        const updated = nextNotes.find((n) => n.id === targetNoteId);
        if (updated) {
          setNote(updated);
          emit("note-sync", { note: updated, isVault: false }).catch(() => {});
        }
      }
    } catch {
      // Ignore
    }
  };

  const handleRemoveAttachment = async (
    targetNoteId: string,
    attachmentId: string
  ) => {
    try {
      if (isVault) {
        const manifest = await api.removeVaultNoteAttachment(
          targetNoteId,
          attachmentId
        );
        const updated = manifest.notes.find((n) => n.id === targetNoteId);
        if (updated) {
          setNote(updated);
          emit("note-sync", { note: updated, isVault: true }).catch(() => {});
        }
      } else {
        const nextNotes = await api.removePublicAttachment(
          targetNoteId,
          attachmentId
        );
        const updated = nextNotes.find((n) => n.id === targetNoteId);
        if (updated) {
          setNote(updated);
          emit("note-sync", { note: updated, isVault: false }).catch(() => {});
        }
      }
    } catch {
      // Ignore
    }
  };

  const handleExportAttachment = async (att: NoteAttachment) => {
    try {
      const dir = await open({ directory: true, multiple: false });
      if (!dir || Array.isArray(dir)) return;
      if (isVault) {
        await api.exportVaultFile(att.id, dir);
      } else {
        await api.exportPublicAttachment(att.stored_name, att.name, dir);
      }
    } catch {
      // Ignore
    }
  };

  if (!note) {
    return (
      <div className={`popout-root ${theme === "light" ? "theme-light" : "theme-dark"}`} />
    );
  }

  return (
    <div className={`popout-root ${theme === "light" ? "theme-light" : "theme-dark"}`}>
      <NoteCard
        note={note}
        lang={lang}
        focused={false}
        isPopout={true}
        isVault={isVault}
        onFocus={() => {}}
        onChange={handleNoteChange}
        onAttachFiles={handleAttachFiles}
        onRemoveAttachment={handleRemoveAttachment}
        onExportAttachment={handleExportAttachment}
        onToggleDesktopWidget={handleToggleDesktopWidget}
        onDelete={async () => {
          if (isVault) {
            const manifest = await api.getVaultManifest();
            await api.saveVaultNotes(manifest.notes.filter((n) => n.id !== note.id));
          } else {
            const store = await api.getPublicStore();
            await api.savePublicNotes(store.notes.filter((n) => n.id !== note.id));
          }
          emit("note-deleted", { noteId: note.id, isVault }).catch(() => {});
          getCurrentWindow().close();
        }}
        onTogglePin={handleTogglePin}
        onClosePopout={() => getCurrentWindow().close()}
        onStealthCandidate={!isVault ? handleStealthCandidate : undefined}
      />
    </div>
  );
};
