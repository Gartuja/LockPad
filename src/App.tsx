import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import { emit, listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  EyeOff,
  KeyRound,
  ListTodo,
  Lock,
  Minus,
  Moon,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  StickyNote as StickyIcon,
  Sun,
  X,
} from "lucide-react";
import { api } from "./api";
import { getStrings } from "./i18n";
import { htmlToPlainText } from "./utils/richText";
import type {
  AppPreferences,
  NoteAttachment,
  StickyNote,
  VaultManifest,
  VaultStatus,
} from "./types";
import { NoteCard } from "./components/NoteCard";
import { VaultFilesSection } from "./components/VaultFilesSection";
import { SettingsModal } from "./components/SettingsModal";
import { UninstallGate } from "./components/UninstallGate";
import { PopoutNoteView } from "./components/PopoutNoteView";
import { OnboardingScreen } from "./components/OnboardingScreen";

const DEFAULT_PREFS: AppPreferences = {
  theme: "dark",
  language: "pt",
  always_on_top: false,
  auto_lock_seconds: 180,
  screen_protect: true,
  stealth_trigger_enabled: true,
  protect_public_notes_on_wipe: false,
};

function makeEmptyNote(isChecklist = false, color: StickyNote["color"] = "indigo"): StickyNote {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: "",
    content: "",
    color,
    is_checklist: isChecklist,
    checklist: isChecklist ? [{ id: crypto.randomUUID(), text: "", checked: false }] : [],
    pinned: false,
    desktop_widget: false,
    attachments: [],
    created_at: now,
    updated_at: now,
  };
}

export const App: React.FC = () => {
  const popoutParams = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const noteId = params.get("popout");
    if (!noteId) return null;
    return {
      noteId,
      isVault: params.get("vault") === "1",
      theme: (params.get("theme") === "light" ? "light" : "dark") as "dark" | "light",
    };
  }, []);

  const [uninstallGate, setUninstallGate] = useState<boolean | null>(null);
  const [publicNotes, setPublicNotes] = useState<StickyNote[]>([]);
  const [preferences, setPreferences] = useState<AppPreferences>(DEFAULT_PREFS);
  const [vaultStatus, setVaultStatus] = useState<VaultStatus>({
    exists: false,
    unlocked: false,
    failed_attempts: 0,
    lockout_remaining_secs: 0,
    screen_protect_active: false,
    note_count: null,
    file_count: null,
    folder_count: null,
  });
  const [vaultManifest, setVaultManifest] = useState<VaultManifest | null>(null);
  const [focusedNoteId, setFocusedNoteId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showQuickUnlock, setShowQuickUnlock] = useState(false);
  const [quickPass, setQuickPass] = useState("");
  const [quickUnlockError, setQuickUnlockError] = useState<string | null>(null);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [detachedIds, setDetachedIds] = useState<string[]>([]);
  const [appVersion, setAppVersion] = useState("2.0.0");
  const [storeLoaded, setStoreLoaded] = useState(false);
  const [banner, setBanner] = useState<{ text: string; isError?: boolean } | null>(null);
  const t = getStrings(preferences.language);

  const stealthInFlightRef = useRef(false);
  const publicSaveTimerRef = useRef<number | null>(null);
  const vaultSaveTimerRef = useRef<number | null>(null);

  const flashBanner = useCallback((text: string, isError = false) => {
    setBanner({ text, isError });
    window.setTimeout(() => {
      setBanner((prev) => (prev?.text === text ? null : prev));
    }, 3800);
  }, []);

  const loadVaultSession = useCallback(async () => {
    const [st, manifest] = await Promise.all([
      api.getVaultStatus(),
      api.getVaultManifest(),
    ]);
    setVaultStatus(st);
    setVaultManifest(manifest);
    setSearchQuery("");
    setFocusedNoteId(manifest.notes[0]?.id ?? null);
  }, []);

  const handleLockVault = useCallback(async () => {
    setVaultManifest(null);
    setSearchQuery("");
    const st = await api.lockVault();
    setVaultStatus(st);
  }, []);

  useEffect(() => {
    if (popoutParams) return;
    let unlistenAutoLock: (() => void) | undefined;
    let unlistenNoteSync: (() => void) | undefined;
    let unlistenNoteDeleted: (() => void) | undefined;
    let unlistenPopoutClosed: (() => void) | undefined;
    let unlistenVaultUnlocked: (() => void) | undefined;
    let unlistenOpenSettings: (() => void) | undefined;
    let unlistenCloseReq: (() => void) | undefined;

    (async () => {
      const gate = await api.isUninstallGateMode();
      setUninstallGate(gate);
      if (gate) return;

      getVersion().then((v) => setAppVersion(v)).catch(() => {});

      const [store, st] = await Promise.all([
        api.getPublicStore(),
        api.getVaultStatus(),
      ]);
      setPublicNotes(store.notes);
      setPreferences(store.preferences);
      setStoreLoaded(true);
      setVaultStatus(st);
      if (st.unlocked) {
        const m = await api.getVaultManifest();
        setVaultManifest(m);
      }

      unlistenAutoLock = await listen("vault-auto-locked", async () => {
        setVaultManifest(null);
        const updatedSt = await api.getVaultStatus();
        setVaultStatus(updatedSt);
        flashBanner(getStrings(preferences.language).autoLockedMsg);
      });

      unlistenVaultUnlocked = await listen("vault-unlocked", async () => {
        await loadVaultSession();
      });

      unlistenOpenSettings = await listen("open-settings-danger", () => {
        setShowSettings(true);
      });

      unlistenPopoutClosed = await listen<string>("note-popout-closed", (ev) => {
        setDetachedIds((prev) => prev.filter((id) => id !== ev.payload));
      });

      unlistenNoteSync = await listen<{ note: StickyNote; isVault: boolean }>(
        "note-sync",
        (ev) => {
          const { note, isVault } = ev.payload;
          if (isVault) {
            setVaultManifest((prev) =>
              prev
                ? {
                    ...prev,
                    notes: prev.notes.map((n) => (n.id === note.id ? note : n)),
                  }
                : prev
            );
          } else {
            setPublicNotes((prev) => prev.map((n) => (n.id === note.id ? note : n)));
          }
        }
      );

      unlistenNoteDeleted = await listen<{ noteId: string; isVault: boolean }>(
        "note-deleted",
        (ev) => {
          const { noteId, isVault } = ev.payload;
          if (isVault) {
            setVaultManifest((prev) =>
              prev
                ? { ...prev, notes: prev.notes.filter((n) => n.id !== noteId) }
                : prev
            );
          } else {
            setPublicNotes((prev) => prev.filter((n) => n.id !== noteId));
          }
        }
      );

      unlistenCloseReq = await getCurrentWindow().onCloseRequested((event) => {
        event.preventDefault();
        setShowCloseConfirm(true);
      });
    })();

    return () => {
      if (unlistenAutoLock) unlistenAutoLock();
      if (unlistenNoteSync) unlistenNoteSync();
      if (unlistenNoteDeleted) unlistenNoteDeleted();
      if (unlistenPopoutClosed) unlistenPopoutClosed();
      if (unlistenVaultUnlocked) unlistenVaultUnlocked();
      if (unlistenOpenSettings) unlistenOpenSettings();
      if (unlistenCloseReq) unlistenCloseReq();
    };
  }, [flashBanner, loadVaultSession, popoutParams]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "l" && vaultStatus.unlocked) {
        e.preventDefault();
        handleLockVault();
      } else if (
        e.ctrlKey &&
        e.shiftKey &&
        e.key.toLowerCase() === "k" &&
        vaultStatus.exists &&
        !vaultStatus.unlocked
      ) {
        e.preventDefault();
        setShowQuickUnlock(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [vaultStatus.unlocked, vaultStatus.exists, handleLockVault]);

  const persistPublicNotes = useCallback((next: StickyNote[]) => {
    setPublicNotes(next);
    if (publicSaveTimerRef.current) window.clearTimeout(publicSaveTimerRef.current);
    publicSaveTimerRef.current = window.setTimeout(() => {
      api.savePublicNotes(next).catch(() => {});
    }, 240);
  }, []);

  const persistVaultNotes = useCallback(
    (nextNotes: StickyNote[]) => {
      if (!vaultManifest) return;
      setVaultManifest({ ...vaultManifest, notes: nextNotes });
      if (vaultSaveTimerRef.current) window.clearTimeout(vaultSaveTimerRef.current);
      vaultSaveTimerRef.current = window.setTimeout(() => {
        api.saveVaultNotes(nextNotes).catch((err) => flashBanner(String(err), true));
      }, 240);
    },
    [vaultManifest, flashBanner]
  );

  const handlePreferencesChange = async (next: AppPreferences) => {
    setPreferences(next);
    emit("theme-sync", next.theme).catch(() => {});
    emit("lang-sync", next.language ?? "pt").catch(() => {});
    try {
      await api.savePreferences(next);
      const st = await api.getVaultStatus();
      setVaultStatus(st);
    } catch (err) {
      flashBanner(String(err), true);
    }
  };

  const handleStealthCandidate = useCallback(
    async (candidate: string, onMatchedCleanup: () => void) => {
      if (
        !preferences.stealth_trigger_enabled ||
        !vaultStatus.exists ||
        vaultStatus.unlocked ||
        stealthInFlightRef.current
      ) {
        return;
      }
      stealthInFlightRef.current = true;
      try {
        const matched = await api.stealthTryUnlock(candidate);
        if (matched) {
          // Immediately clear the passphrase from the normal sticky note & persist clean state
          if (publicSaveTimerRef.current) window.clearTimeout(publicSaveTimerRef.current);
          onMatchedCleanup();
          await loadVaultSession();
        }
      } catch {
        // Ignore silent check errors
      } finally {
        stealthInFlightRef.current = false;
      }
    },
    [preferences.stealth_trigger_enabled, vaultStatus.exists, vaultStatus.unlocked, loadVaultSession]
  );

  const handleQuickUnlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setQuickUnlockError(null);
    try {
      const ok = await api.tryUnlockVault(quickPass);
      if (ok) {
        setQuickPass("");
        setQuickUnlockError(null);
        setShowQuickUnlock(false);
        await loadVaultSession();
      } else {
        setQuickUnlockError(t.wrongPassphrase);
      }
    } catch (err) {
      setQuickUnlockError(String(err));
    }
  };

  const isVaultView = vaultStatus.unlocked && vaultManifest !== null;

  const displayedNotes = useMemo(() => {
    const source = (isVaultView ? vaultManifest.notes : publicNotes).filter(
      (n) => !detachedIds.includes(n.id)
    );
    const q = searchQuery.trim().toLowerCase();
    const filtered = q
      ? source.filter(
          (n) =>
            n.title.toLowerCase().includes(q) ||
            htmlToPlainText(n.content).toLowerCase().includes(q) ||
            n.checklist.some((c) => c.text.toLowerCase().includes(q))
        )
      : source;
    return [...filtered].sort((a, b) => Number(b.pinned) - Number(a.pinned));
  }, [isVaultView, vaultManifest, publicNotes, searchQuery, detachedIds]);

  if (popoutParams) {
    return (
      <PopoutNoteView
        noteId={popoutParams.noteId}
        isVault={popoutParams.isVault}
        initialTheme={popoutParams.theme}
      />
    );
  }

  if (uninstallGate === null || !storeLoaded) {
    return null;
  }
  if (uninstallGate) {
    return <UninstallGate />;
  }
  if (!preferences.onboarding_completed) {
    return (
      <OnboardingScreen
        initialLanguage={preferences.language ?? "pt"}
        onLanguageChange={(lang) =>
          setPreferences((prev) => ({ ...prev, language: lang }))
        }
        onCompleted={(store) => {
          setPublicNotes(store.notes);
          setPreferences(store.preferences);
        }}
      />
    );
  }

  const updateNote = (updated: StickyNote) => {
    emit("note-sync", { note: updated, isVault: isVaultView }).catch(() => {});
    if (isVaultView && vaultManifest) {
      api.touchVaultActivity().catch(() => {});
      persistVaultNotes(
        vaultManifest.notes.map((n) => (n.id === updated.id ? updated : n))
      );
    } else {
      persistPublicNotes(publicNotes.map((n) => (n.id === updated.id ? updated : n)));
    }
  };

  const handlePopoutNote = async (
    note: StickyNote,
    screenX?: number,
    screenY?: number
  ) => {
    try {
      if (isVaultView && vaultManifest) {
        await api.saveVaultNotes(vaultManifest.notes);
      } else {
        await api.savePublicNotes(publicNotes);
      }
      setDetachedIds((prev) => (prev.includes(note.id) ? prev : [...prev, note.id]));
      await api.openNoteWindow(
        note.id,
        isVaultView,
        screenX ?? null,
        screenY ?? null,
        note.pinned,
        Boolean(note.desktop_widget),
        preferences.theme
      );
    } catch (err) {
      flashBanner(String(err), true);
    }
  };

  const handleTogglePin = async (updated: StickyNote) => {
    try {
      if (isVaultView && vaultManifest) {
        await api.saveVaultNotes(
          vaultManifest.notes.map((n) => (n.id === updated.id ? updated : n))
        );
      } else {
        await api.savePublicNotes(
          publicNotes.map((n) => (n.id === updated.id ? updated : n))
        );
      }
      if (updated.pinned) {
        setDetachedIds((prev) =>
          prev.includes(updated.id) ? prev : [...prev, updated.id]
        );
        await api.openNoteWindow(
          updated.id,
          isVaultView,
          null,
          null,
          true,
          false,
          preferences.theme
        );
        await api.setNoteWindowPinned(updated.id, isVaultView, true);
      } else {
        setDetachedIds((prev) => prev.filter((id) => id !== updated.id));
        await api.setNoteWindowPinned(updated.id, isVaultView, false);
        await api.closeNoteWindow(updated.id, isVaultView);
      }
    } catch (err) {
      flashBanner(String(err), true);
    }
  };

  const handleToggleDesktopWidget = async (updated: StickyNote) => {
    try {
      if (isVaultView && vaultManifest) {
        await api.saveVaultNotes(
          vaultManifest.notes.map((n) => (n.id === updated.id ? updated : n))
        );
      } else {
        await api.savePublicNotes(
          publicNotes.map((n) => (n.id === updated.id ? updated : n))
        );
      }
      if (updated.desktop_widget) {
        setDetachedIds((prev) =>
          prev.includes(updated.id) ? prev : [...prev, updated.id]
        );
        await api.openNoteWindow(
          updated.id,
          isVaultView,
          null,
          null,
          false,
          true,
          preferences.theme
        );
        await api.setNoteWindowDesktopWidget(updated.id, isVaultView, true);
      } else {
        setDetachedIds((prev) => prev.filter((id) => id !== updated.id));
        await api.setNoteWindowDesktopWidget(updated.id, isVaultView, false);
        await api.closeNoteWindow(updated.id, isVaultView);
      }
    } catch (err) {
      flashBanner(String(err), true);
    }
  };

  const handleAttachFiles = async (noteId: string) => {
    if (isVaultView) return;
    try {
      const selected = await open({ multiple: true });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      if (publicSaveTimerRef.current) {
        window.clearTimeout(publicSaveTimerRef.current);
        publicSaveTimerRef.current = null;
      }
      const nextNotes = await api.attachPublicFiles(noteId, paths);
      setPublicNotes(nextNotes);
      const updated = nextNotes.find((n) => n.id === noteId);
      if (updated) {
        emit("note-sync", { note: updated, isVault: false }).catch(() => {});
      }
    } catch (err) {
      flashBanner(String(err), true);
    }
  };

  const handleRemoveAttachment = async (noteId: string, attachmentId: string) => {
    if (isVaultView) return;
    try {
      if (publicSaveTimerRef.current) {
        window.clearTimeout(publicSaveTimerRef.current);
        publicSaveTimerRef.current = null;
      }
      const nextNotes = await api.removePublicAttachment(noteId, attachmentId);
      setPublicNotes(nextNotes);
      const updated = nextNotes.find((n) => n.id === noteId);
      if (updated) {
        emit("note-sync", { note: updated, isVault: false }).catch(() => {});
      }
    } catch (err) {
      flashBanner(String(err), true);
    }
  };

  const handleExportAttachment = async (att: NoteAttachment) => {
    try {
      const dir = await open({ directory: true, multiple: false });
      if (!dir || Array.isArray(dir)) return;
      const dest = await api.exportPublicAttachment(
        att.stored_name,
        att.name,
        dir
      );
      flashBanner(dest);
    } catch (err) {
      flashBanner(String(err), true);
    }
  };

  const deleteNote = (id: string) => {
    api.closeNoteWindow(id, isVaultView).catch(() => {});
    if (isVaultView && vaultManifest) {
      persistVaultNotes(vaultManifest.notes.filter((n) => n.id !== id));
    } else {
      persistPublicNotes(publicNotes.filter((n) => n.id !== id));
    }
  };

  const addNote = (isChecklist: boolean) => {
    const note = makeEmptyNote(isChecklist, isVaultView ? "emerald" : "indigo");
    if (isVaultView && vaultManifest) {
      persistVaultNotes([note, ...vaultManifest.notes]);
    } else {
      persistPublicNotes([note, ...publicNotes]);
    }
    setFocusedNoteId(note.id);
  };

  return (
    <div
      className={`app-shell ${
        preferences.theme === "light" ? "theme-light" : "theme-dark"
      } ${isVaultView ? "vault-active" : ""}`}
    >
      {/* Titlebar */}
      <header className="titlebar" data-tauri-drag-region>
        <div className="titlebar-left" data-tauri-drag-region>
          <div className="brand-mark">
            {isVaultView ? <ShieldCheck size={16} /> : <StickyIcon size={16} />}
          </div>
          <div className="brand-title" data-tauri-drag-region>
            <span>{isVaultView ? "LockPad Vault" : "LockPad"}</span>
            <span className="version-badge">v{appVersion}</span>
            {isVaultView && (
              <span className="vault-pill">
                <Lock size={10} />
                {vaultStatus.screen_protect_active ? t.antiCapture : t.encrypted}
              </span>
            )}
          </div>
        </div>

        <div className="titlebar-actions">
          <button
            className="icon-btn"
            title={preferences.theme === "dark" ? t.themeDarkTip : t.themeLightTip}
            onClick={() =>
              handlePreferencesChange({
                ...preferences,
                theme: preferences.theme === "dark" ? "light" : "dark",
              })
            }
          >
            {preferences.theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          <button
            className="icon-btn"
            title={t.settingsTitle}
            onClick={() => setShowSettings(true)}
          >
            <Settings size={14} />
          </button>
          <button
            className="icon-btn"
            title={t.minimizeTip}
            onClick={() => api.minimizeWindow()}
          >
            <Minus size={14} />
          </button>
          <button
            className="icon-btn danger"
            title={t.closeTip}
            onClick={() => setShowCloseConfirm(true)}
          >
            <X size={14} />
          </button>
        </div>
      </header>

      {/* Search + Quick Lock */}
      <div className="top-toolbar">
        <div className="search-box">
          <Search size={14} />
          <input
            placeholder={isVaultView ? t.searchVault : t.searchPublic}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        {isVaultView ? (
          <button
            className="lock-now-btn"
            onClick={handleLockVault}
            title={t.closeVaultTip}
          >
            <EyeOff size={13} /> {t.closeVault}
          </button>
        ) : (
          vaultStatus.exists && (
            <button
              className="icon-btn"
              title={t.unlockVaultTip}
              onClick={() => setShowQuickUnlock(true)}
            >
              <KeyRound size={14} />
            </button>
          )
        )}
      </div>

      {banner && (
        <div style={{ padding: "0 16px 8px" }}>
          <div className={banner.isError ? "alert-banner" : "success-banner"}>
            {banner.text}
          </div>
        </div>
      )}

      {/* Notes & Vault Content */}
      <main className="main-scroll">
        {displayedNotes.map((note) => (
          <NoteCard
            key={note.id}
            note={note}
            lang={preferences.language}
            focused={focusedNoteId === note.id}
            onFocus={() => setFocusedNoteId(note.id)}
            onChange={updateNote}
            onDelete={deleteNote}
            onTogglePin={handleTogglePin}
            onToggleDesktopWidget={handleToggleDesktopWidget}
            onAttachFiles={!isVaultView ? handleAttachFiles : undefined}
            onRemoveAttachment={!isVaultView ? handleRemoveAttachment : undefined}
            onExportAttachment={!isVaultView ? handleExportAttachment : undefined}
            onPopout={handlePopoutNote}
            onStealthCandidate={!isVaultView ? handleStealthCandidate : undefined}
          />
        ))}

        {displayedNotes.length === 0 && (
          <div
            style={{
              textAlign: "center",
              padding: "24px 12px",
              color: "var(--text-muted)",
              fontSize: 12.5,
            }}
          >
            {t.noNotesFound} <strong>+ {isVaultView ? t.secretNote : t.newNote}</strong>.
          </div>
        )}

        {isVaultView && vaultManifest && (
          <VaultFilesSection
            manifest={vaultManifest}
            lang={preferences.language}
            onManifestUpdate={(next) => setVaultManifest(next)}
            onStatusMessage={flashBanner}
          />
        )}
      </main>

      {/* Bottom Floating Dock */}
      <footer className="bottom-dock">
        <button className="dock-primary-btn" onClick={() => addNote(false)}>
          <Plus size={16} /> {isVaultView ? t.secretNote : t.newNote}
        </button>

        <div className="dock-tools">
          <button
            className="icon-btn"
            title={t.newChecklist}
            onClick={() => addNote(true)}
          >
            <ListTodo size={16} />
          </button>
          <button
            className="icon-btn"
            title={t.settingsTitle}
            onClick={() => setShowSettings(true)}
          >
            <Settings size={16} />
          </button>
        </div>
      </footer>

      {/* Quick Masked Unlock Modal */}
      {showQuickUnlock && !isVaultView && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setShowQuickUnlock(false);
            setQuickUnlockError(null);
          }}
        >
          <div
            className="modal-card"
            style={{ maxWidth: 360 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="modal-title">
                <Lock size={16} style={{ color: "var(--accent)" }} />
                {t.unlockModalTitle}
              </div>
              <button
                className="icon-btn"
                onClick={() => {
                  setShowQuickUnlock(false);
                  setQuickUnlockError(null);
                }}
              >
                <X size={16} />
              </button>
            </div>
            {quickUnlockError && (
              <div className="alert-banner">{quickUnlockError}</div>
            )}
            <form onSubmit={handleQuickUnlockSubmit} className="field-group">
              <input
                type="password"
                className="field-input"
                placeholder={t.passphrasePlaceholder}
                value={quickPass}
                onChange={(e) => {
                  setQuickPass(e.target.value);
                  if (quickUnlockError) setQuickUnlockError(null);
                }}
                autoFocus
              />
              <button type="submit" className="btn btn-primary">
                {t.openSecureNote}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Close Confirmation Modal */}
      {showCloseConfirm && (
        <div
          className="modal-backdrop"
          onClick={() => setShowCloseConfirm(false)}
        >
          <div
            className="modal-card"
            style={{ maxWidth: 370 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="modal-title">
                <AlertTriangle size={17} style={{ color: "var(--danger)" }} />
                {t.closeConfirmTitle}
              </div>
              <button
                className="icon-btn"
                onClick={() => setShowCloseConfirm(false)}
              >
                <X size={16} />
              </button>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
              {t.closeConfirmBody}
              {isVaultView && t.closeConfirmVaultExtra}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                className="btn"
                onClick={() => setShowCloseConfirm(false)}
              >
                {t.cancel}
              </button>
              <button
                className="btn btn-danger"
                onClick={() => api.exitApp()}
              >
                {t.closeApp}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings & Security Modal */}
      {showSettings && (
        <SettingsModal
          preferences={preferences}
          vaultStatus={vaultStatus}
          onClose={() => setShowSettings(false)}
          onPreferencesChange={handlePreferencesChange}
          onVaultStatusChange={setVaultStatus}
          onVaultUnlocked={loadVaultSession}
          onVaultDestroyed={async (alsoWipedPublic) => {
            setVaultManifest(null);
            if (alsoWipedPublic) {
              const store = await api.getPublicStore();
              setPublicNotes(store.notes);
            }
          }}
        />
      )}
    </div>
  );
};
