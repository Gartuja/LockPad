import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Check, ExternalLink, GripVertical, Image as ImageIcon, ListTodo, Palette, Pin, Plus, Trash2, Type, X } from "lucide-react";
import { getStrings } from "../i18n";
import {
  htmlToPlainText,
  queryFormatState,
  sanitizeNoteHtml,
  toggleEditorFormat,
  type FormatCmd,
} from "../utils/richText";
import type { Language, NoteColor, StickyNote } from "../types";

const FONT_OPTIONS: { id: string; label: string; css: string }[] = [
  { id: "sans", label: "Padrão (Inter / Segoe)", css: '"Inter", "Segoe UI", "Ubuntu", "Noto Sans", system-ui, sans-serif' },
  { id: "rounded", label: "Arredondada (Trebuchet)", css: '"Trebuchet MS", "Ubuntu", "DejaVu Sans", sans-serif' },
  { id: "clean", label: "Clean (Calibri / Carlito)", css: 'Calibri, Carlito, "Liberation Sans", "Segoe UI", sans-serif' },
  { id: "humanist", label: "Humanista (Verdana)", css: 'Verdana, "DejaVu Sans", Geneva, sans-serif' },
  { id: "compact", label: "Compacta (Tahoma)", css: 'Tahoma, "Liberation Sans", Geneva, sans-serif' },
  { id: "geometric", label: "Geométrica (Century)", css: '"Century Gothic", "URW Gothic", Futura, sans-serif' },
  { id: "serif", label: "Clássica (Georgia)", css: 'Georgia, "Liberation Serif", "Times New Roman", serif' },
  { id: "editorial", label: "Editorial (Cambria)", css: 'Cambria, Caladea, Georgia, serif' },
  { id: "elegant", label: "Elegante (Palatino)", css: '"Palatino Linotype", "Book Antiqua", "URW Bookman", serif' },
  { id: "times", label: "Tradicional (Times)", css: '"Times New Roman", "Liberation Serif", Times, serif' },
  { id: "mono", label: "Código (Consolas / Mono)", css: '"Cascadia Code", Consolas, "JetBrains Mono", "DejaVu Sans Mono", monospace' },
  { id: "courier", label: "Técnica (Courier)", css: '"Courier New", "Liberation Mono", Courier, monospace' },
  { id: "lucida", label: "Terminal (Lucida)", css: '"Lucida Console", "Ubuntu Mono", Monaco, monospace' },
  { id: "script", label: "Manuscrita (Script)", css: '"Segoe Script", "Comic Sans MS", "URW Chancery L", cursive' },
  { id: "impact", label: "Destaque (Impact)", css: 'Impact, "Arial Black", "Liberation Sans", sans-serif' },
];

const COLORS: { id: NoteColor; hex: string }[] = [
  { id: "indigo", hex: "#638cff" },
  { id: "sky", hex: "#0ea5e9" },
  { id: "teal", hex: "#14b8a6" },
  { id: "emerald", hex: "#10b981" },
  { id: "amber", hex: "#f59e0b" },
  { id: "orange", hex: "#f97316" },
  { id: "rose", hex: "#f43f5e" },
  { id: "pink", hex: "#ec4899" },
  { id: "violet", hex: "#8b5cf6" },
  { id: "slate", hex: "#64748b" },
];

interface NoteCardProps {
  note: StickyNote;
  lang?: Language;
  focused: boolean;
  onFocus: () => void;
  onChange: (updated: StickyNote) => void;
  onDelete: (id: string) => void;
  onTogglePin?: (note: StickyNote) => void;
  onPopout?: (note: StickyNote, screenX?: number, screenY?: number) => void;
  onClosePopout?: () => void;
  isPopout?: boolean;
  onStealthCandidate?: (candidate: string, onMatchedCleanup: () => void) => void;
}

export const NoteCard: React.FC<NoteCardProps> = ({
  note,
  lang,
  focused,
  onFocus,
  onChange,
  onDelete,
  onTogglePin,
  onPopout,
  onClosePopout,
  isPopout,
  onStealthCandidate,
}) => {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fontBtnRef = useRef<HTMLButtonElement | null>(null);
  const debounceRef = useRef<number | null>(null);
  const lastSavedHtmlRef = useRef<string>(sanitizeNoteHtml(note.content));
  const lastDomHtmlRef = useRef<string>("");
  const [draggingOut, setDraggingOut] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mediaMenuOpen, setMediaMenuOpen] = useState(false);
  const [fontSizeOpen, setFontSizeOpen] = useState(false);
  const [fontFamilyOpen, setFontFamilyOpen] = useState(false);
  const [activeFormats, setActiveFormats] = useState({
    bold: false,
    italic: false,
    strikeThrough: false,
    underline: false,
  });
  const [fontMenuPos, setFontMenuPos] = useState<{ top: number; left: number }>({
    top: 40,
    left: 40,
  });

  const t = getStrings(lang);
  const activeFontSize = Math.min(26, Math.max(11, note.font_size ?? 13));
  const activeFontCss =
    FONT_OPTIONS.find((f) => f.id === (note.font_family ?? "sans"))?.css ??
    FONT_OPTIONS[0].css;

  const refreshActiveFormats = () => {
    const el = editorRef.current;
    setActiveFormats({
      bold: queryFormatState(el, "bold"),
      italic: queryFormatState(el, "italic"),
      strikeThrough: queryFormatState(el, "strikeThrough"),
      underline: queryFormatState(el, "underline"),
    });
  };

  useEffect(() => {
    const el = editorRef.current;
    if (!el || note.is_checklist) return;
    if (document.activeElement === el) return;
    const sanitized = sanitizeNoteHtml(note.content);
    if (sanitized !== lastDomHtmlRef.current) {
      el.innerHTML = sanitized;
      lastDomHtmlRef.current = sanitized;
    }
  }, [note.id, note.content, note.is_checklist]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, []);

  const triggerStealthCheck = (plainText: string, previousSafeHtml: string) => {
    if (!onStealthCandidate) return;
    const trimmed = plainText.trim();
    if (trimmed.length < 4) return;
    const lines = plainText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const lastLine = lines.length > 0 ? lines[lines.length - 1] : "";

    const cleanup = () => {
      lastDomHtmlRef.current = previousSafeHtml;
      lastSavedHtmlRef.current = previousSafeHtml;
      if (editorRef.current) {
        editorRef.current.innerHTML = previousSafeHtml;
      }
      onChange({
        ...note,
        content: previousSafeHtml,
        updated_at: new Date().toISOString(),
      });
    };

    if (lastLine.length >= 4 && lastLine !== trimmed) {
      onStealthCandidate(lastLine, cleanup);
    }
    onStealthCandidate(trimmed, cleanup);
  };

  const commitEditorHtml = (rawHtml: string, plainText: string) => {
    const prevSafe = lastSavedHtmlRef.current;
    const cleanHtml = sanitizeNoteHtml(rawHtml);
    lastDomHtmlRef.current = cleanHtml;

    onChange({
      ...note,
      content: cleanHtml,
      updated_at: new Date().toISOString(),
    });

    if (onStealthCandidate) {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        triggerStealthCheck(plainText, prevSafe);
        lastSavedHtmlRef.current = cleanHtml;
      }, 650);
    } else {
      lastSavedHtmlRef.current = cleanHtml;
    }
  };

  const handleEditorInput = () => {
    const el = editorRef.current;
    if (!el) return;
    commitEditorHtml(el.innerHTML, el.innerText ?? "");
    refreshActiveFormats();
  };

  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" && onStealthCandidate && editorRef.current) {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      triggerStealthCheck(
        editorRef.current.innerText ?? "",
        lastSavedHtmlRef.current
      );
    }
  };

  const handleEditorPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const plain = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, plain);
  };

  const applyFormat = (cmd: FormatCmd) => {
    const el = editorRef.current;
    if (!el) return;
    if (document.activeElement !== el) {
      el.focus();
    }
    toggleEditorFormat(el, cmd);
    commitEditorHtml(el.innerHTML, el.innerText ?? "");
    refreshActiveFormats();
  };

  const toggleChecklistMode = () => {
    if (!note.is_checklist) {
      const plain = htmlToPlainText(note.content);
      const lines = plain
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      const items =
        lines.length > 0
          ? lines.map((text) => ({
              id: crypto.randomUUID(),
              text,
              checked: false,
            }))
          : [{ id: crypto.randomUUID(), text: "", checked: false }];
      onChange({
        ...note,
        is_checklist: true,
        checklist: items,
        updated_at: new Date().toISOString(),
      });
    } else {
      const text = sanitizeNoteHtml(note.checklist.map((c) => c.text).join("\n"));
      lastDomHtmlRef.current = "";
      onChange({
        ...note,
        is_checklist: false,
        content: text,
        updated_at: new Date().toISOString(),
      });
    }
  };

  const handleStartDragOut = (e: React.MouseEvent) => {
    if (!onPopout) return;
    e.preventDefault();
    setDraggingOut(true);

    const onMove = (ev: MouseEvent) => {
      const outside =
        ev.clientX < -8 ||
        ev.clientY < -8 ||
        ev.clientX > window.innerWidth + 8 ||
        ev.clientY > window.innerHeight + 8;
      if (outside) {
        cleanup();
        onPopout(note, ev.screenX - 150, ev.screenY - 24);
      }
    };

    const onUp = (ev: MouseEvent) => {
      const outside =
        ev.clientX < 0 ||
        ev.clientY < 0 ||
        ev.clientX > window.innerWidth ||
        ev.clientY > window.innerHeight;
      cleanup();
      if (outside) {
        onPopout(note, ev.screenX - 150, ev.screenY - 24);
      }
    };

    const cleanup = () => {
      setDraggingOut(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handlePopoutMouseDown = (e: React.MouseEvent) => {
    if (!isPopout || e.button !== 0) return;
    const target = e.target as HTMLElement;
    // Allow dragging from the grip or empty header space (not buttons or inputs)
    if (target.closest("button") || target.closest("input")) return;
    e.preventDefault();
    getCurrentWindow().startDragging().catch(() => {});
  };

  const handlePickBackgroundMedia = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/gif"].includes(file.type)) {
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        onChange({
          ...note,
          background_image: reader.result,
          updated_at: new Date().toISOString(),
        });
        setMediaMenuOpen(false);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div
      className={`note-card note-color-${note.color || "indigo"} ${focused ? "focused" : ""}`}
      style={draggingOut ? { opacity: 0.72, transform: "scale(0.985)" } : undefined}
      onMouseDown={onFocus}
    >
      {note.background_image && (
        <div className="note-bg-wrap">
          <img className="note-bg-media" src={note.background_image} alt="" />
          <div className="note-bg-scrim" />
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif"
        style={{ display: "none" }}
        onChange={handlePickBackgroundMedia}
      />
      <div className={`note-card-strip strip-${note.color || "indigo"}`} style={{ zIndex: 1 }} />
      <div
        className="note-header"
        onMouseDown={isPopout ? handlePopoutMouseDown : undefined}
      >
        {isPopout ? (
          <span
            className="note-drag-grip"
            title={t.dragMoveTip}
            onMouseDown={(e) => {
              e.preventDefault();
              getCurrentWindow().startDragging().catch(() => {});
            }}
          >
            <GripVertical size={15} />
          </span>
        ) : (
          onPopout && (
            <span
              className="note-drag-grip"
              title={t.dragOutTip}
              onMouseDown={handleStartDragOut}
            >
              <GripVertical size={14} />
            </span>
          )
        )}
        <input
          className="note-title-input"
          placeholder={t.noteTitlePlaceholder}
          value={note.title}
          onChange={(e) =>
            onChange({
              ...note,
              title: e.target.value,
              updated_at: new Date().toISOString(),
            })
          }
        />
        {!isPopout && onPopout && (
          <button
            className="mini-btn"
            title={t.popoutTip}
            onClick={(e) => onPopout(note, e.screenX - 150, e.screenY + 20)}
          >
            <ExternalLink size={13} />
          </button>
        )}
        <button
          className={`mini-btn ${note.pinned ? "active" : ""}`}
          title={note.pinned ? t.unpinTip : t.pinTip}
          onClick={() => {
            const nextNote = {
              ...note,
              pinned: !note.pinned,
              updated_at: new Date().toISOString(),
            };
            onChange(nextNote);
            if (onTogglePin) onTogglePin(nextNote);
          }}
        >
          <Pin size={13} />
        </button>
        <button
          className="mini-btn"
          title={t.deleteNoteTip}
          onClick={() => onDelete(note.id)}
        >
          <Trash2 size={13} />
        </button>
        {isPopout && onClosePopout && (
          <button
            className="mini-btn"
            title={t.closePopoutTip}
            onClick={onClosePopout}
          >
            <X size={14} />
          </button>
        )}
      </div>

      {note.is_checklist ? (
        <div className="checklist-list">
          {note.checklist.map((item, idx) => (
            <div key={item.id} className="checklist-row">
              <button
                className={`check-toggle ${item.checked ? "checked" : ""}`}
                onClick={() => {
                  const next = [...note.checklist];
                  next[idx] = { ...item, checked: !item.checked };
                  onChange({
                    ...note,
                    checklist: next,
                    updated_at: new Date().toISOString(),
                  });
                }}
              >
                {item.checked && <Check size={11} strokeWidth={3} />}
              </button>
              <input
                className={`checklist-input ${item.checked ? "checked" : ""}`}
                style={{ fontSize: activeFontSize, fontFamily: activeFontCss }}
                placeholder={t.checklistItemPlaceholder}
                value={item.text}
                onChange={(e) => {
                  const next = [...note.checklist];
                  next[idx] = { ...item, text: e.target.value };
                  onChange({
                    ...note,
                    checklist: next,
                    updated_at: new Date().toISOString(),
                  });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const next = [...note.checklist];
                    next.splice(idx + 1, 0, {
                      id: crypto.randomUUID(),
                      text: "",
                      checked: false,
                    });
                    onChange({
                      ...note,
                      checklist: next,
                      updated_at: new Date().toISOString(),
                    });
                  }
                }}
              />
              <button
                className="mini-btn"
                onClick={() => {
                  const next = note.checklist.filter((c) => c.id !== item.id);
                  onChange({
                    ...note,
                    checklist: next,
                    updated_at: new Date().toISOString(),
                  });
                }}
              >
                ×
              </button>
            </div>
          ))}
          <button
            className="mini-btn"
            style={{ alignSelf: "flex-start" }}
            onClick={() =>
              onChange({
                ...note,
                checklist: [
                  ...note.checklist,
                  { id: crypto.randomUUID(), text: "", checked: false },
                ],
                updated_at: new Date().toISOString(),
              })
            }
          >
            <Plus size={12} /> {t.addItem}
          </button>
        </div>
      ) : (
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          className="note-rich-editor"
          data-placeholder={t.noteContentPlaceholder}
          style={{ fontSize: activeFontSize, fontFamily: activeFontCss }}
          onInput={handleEditorInput}
          onKeyDown={handleEditorKeyDown}
          onKeyUp={refreshActiveFormats}
          onMouseUp={refreshActiveFormats}
          onPaste={handleEditorPaste}
        />
      )}

      <div className="note-toolbar">
        <div className="note-toolbar-group">
          {!note.is_checklist && (
            <>
              <button
                className={`mini-btn ${activeFormats.bold ? "active" : ""}`}
                title={t.bold}
                onMouseDown={(e) => {
                  e.preventDefault();
                  applyFormat("bold");
                }}
              >
                <strong>B</strong>
              </button>
              <button
                className={`mini-btn ${activeFormats.italic ? "active" : ""}`}
                title={t.italic}
                onMouseDown={(e) => {
                  e.preventDefault();
                  applyFormat("italic");
                }}
              >
                <em>I</em>
              </button>
              <button
                className={`mini-btn ${activeFormats.strikeThrough ? "active" : ""}`}
                title={t.strike}
                onMouseDown={(e) => {
                  e.preventDefault();
                  applyFormat("strikeThrough");
                }}
              >
                <s>S</s>
              </button>
              <button
                className={`mini-btn ${activeFormats.underline ? "active" : ""}`}
                title={t.underline}
                onMouseDown={(e) => {
                  e.preventDefault();
                  applyFormat("underline");
                }}
              >
                <u>U</u>
              </button>
            </>
          )}
          <button
            className="mini-btn"
            title={t.toggleChecklist}
            onClick={toggleChecklistMode}
          >
            <ListTodo size={13} />
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <div className="palette-wrap">
            {fontSizeOpen && (
              <div
                className="palette-popover"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 8px",
                }}
              >
                <button
                  className="mini-btn"
                  title={t.decreaseFont}
                  onClick={() =>
                    onChange({
                      ...note,
                      font_size: Math.max(11, activeFontSize - 1),
                      updated_at: new Date().toISOString(),
                    })
                  }
                >
                  A-
                </button>
                <span style={{ fontSize: 11.5, fontWeight: 700, minWidth: 30, textAlign: "center" }}>
                  {activeFontSize}px
                </span>
                <button
                  className="mini-btn"
                  title={t.increaseFont}
                  onClick={() =>
                    onChange({
                      ...note,
                      font_size: Math.min(26, activeFontSize + 1),
                      updated_at: new Date().toISOString(),
                    })
                  }
                >
                  A+
                </button>
              </div>
            )}
            <button
              className={`mini-btn ${note.font_size && note.font_size !== 13 ? "active" : ""}`}
              title={t.fontSizeTip}
              onClick={() => {
                setPaletteOpen(false);
                setMediaMenuOpen(false);
                setFontFamilyOpen(false);
                setFontSizeOpen((v) => !v);
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "baseline",
                  lineHeight: 1,
                  fontWeight: 700,
                  fontFamily: "var(--font-sans)",
                  letterSpacing: "-0.02em",
                }}
              >
                <span style={{ fontSize: 13 }}>A</span>
                <span style={{ fontSize: 9.5 }}>A</span>
              </span>
            </button>
          </div>

          <div className="palette-wrap">
            {fontFamilyOpen &&
              createPortal(
                <>
                  <div
                    style={{ position: "fixed", inset: 0, zIndex: 9998 }}
                    onClick={() => setFontFamilyOpen(false)}
                  />
                  <div
                    className="font-portal-menu"
                    style={{ top: fontMenuPos.top, left: fontMenuPos.left }}
                  >
                    {FONT_OPTIONS.map((f) => (
                      <button
                        key={f.id}
                        className={`mini-btn ${(note.font_family ?? "sans") === f.id ? "active" : ""}`}
                        style={{
                          justifyContent: "flex-start",
                          fontFamily: f.css,
                          fontSize: 12.5,
                          height: 28,
                          flexShrink: 0,
                          width: "100%",
                          padding: "0 8px",
                        }}
                        onClick={() => {
                          onChange({
                            ...note,
                            font_family: f.id,
                            updated_at: new Date().toISOString(),
                          });
                          setFontFamilyOpen(false);
                        }}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </>,
                document.querySelector(".app-shell, .popout-root") ?? document.body
              )}
            <button
              ref={fontBtnRef}
              className={`mini-btn ${note.font_family && note.font_family !== "sans" ? "active" : ""}`}
              title={t.fontFamilyTip}
              onClick={() => {
                setPaletteOpen(false);
                setMediaMenuOpen(false);
                setFontSizeOpen(false);
                if (!fontFamilyOpen && fontBtnRef.current) {
                  const rect = fontBtnRef.current.getBoundingClientRect();
                  const menuW = 205;
                  const menuH = 240;
                  const left = Math.max(
                    8,
                    Math.min(window.innerWidth - menuW - 8, rect.right - menuW)
                  );
                  const openUp = rect.top > menuH + 14;
                  const top = openUp
                    ? Math.max(8, rect.top - menuH - 6)
                    : Math.min(window.innerHeight - menuH - 8, rect.bottom + 6);
                  setFontMenuPos({ top, left });
                }
                setFontFamilyOpen((v) => !v);
              }}
            >
              <Type size={13} />
            </button>
          </div>

          <div className="palette-wrap">
            {mediaMenuOpen && note.background_image && (
              <div
                className="palette-popover"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  minWidth: 138,
                  padding: 6,
                }}
              >
                <button
                  className="mini-btn"
                  style={{ justifyContent: "flex-start" }}
                  onClick={() => {
                    setMediaMenuOpen(false);
                    fileInputRef.current?.click();
                  }}
                >
                  {t.changeBgMedia}
                </button>
                <button
                  className="mini-btn"
                  style={{ justifyContent: "flex-start", color: "var(--danger)" }}
                  onClick={() => {
                    onChange({
                      ...note,
                      background_image: null,
                      updated_at: new Date().toISOString(),
                    });
                    setMediaMenuOpen(false);
                  }}
                >
                  {t.removeBgMedia}
                </button>
              </div>
            )}
            <button
              className={`mini-btn ${note.background_image ? "active" : ""}`}
              title={t.bgMediaTip}
              onClick={() => {
                setPaletteOpen(false);
                setFontSizeOpen(false);
                setFontFamilyOpen(false);
                if (note.background_image) {
                  setMediaMenuOpen((v) => !v);
                } else {
                  fileInputRef.current?.click();
                }
              }}
            >
              <ImageIcon size={14} />
            </button>
          </div>

          <div className="palette-wrap">
            {paletteOpen && (
              <div className="palette-popover">
                {COLORS.map((c) => (
                  <button
                    key={c.id}
                    className={`color-dot ${note.color === c.id ? "selected" : ""}`}
                    style={{ backgroundColor: c.hex }}
                    title={c.id}
                    onClick={() => {
                      onChange({
                        ...note,
                        color: c.id,
                        updated_at: new Date().toISOString(),
                      });
                      setPaletteOpen(false);
                    }}
                  />
                ))}
              </div>
            )}
            <button
              className="mini-btn"
              title={t.colorTip}
              onClick={() => {
                setMediaMenuOpen(false);
                setFontSizeOpen(false);
                setFontFamilyOpen(false);
                setPaletteOpen((v) => !v);
              }}
            >
              <Palette size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
