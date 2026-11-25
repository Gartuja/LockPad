import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Check, ExternalLink, GripVertical, Image as ImageIcon, ListTodo, Palette, Pin, Plus, Trash2, Type, X } from "lucide-react";
import type { NoteColor, StickyNote } from "../types";

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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fontBtnRef = useRef<HTMLButtonElement | null>(null);
  const debounceRef = useRef<number | null>(null);
  const lastSavedContentRef = useRef<string>(note.content);
  const [draggingOut, setDraggingOut] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mediaMenuOpen, setMediaMenuOpen] = useState(false);
  const [fontSizeOpen, setFontSizeOpen] = useState(false);
  const [fontFamilyOpen, setFontFamilyOpen] = useState(false);
  const [fontMenuPos, setFontMenuPos] = useState<{ top: number; left: number }>({
    top: 40,
    left: 40,
  });

  const activeFontSize = Math.min(26, Math.max(11, note.font_size ?? 13));
  const activeFontCss =
    FONT_OPTIONS.find((f) => f.id === (note.font_family ?? "sans"))?.css ??
    FONT_OPTIONS[0].css;

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.max(72, textareaRef.current.scrollHeight)}px`;
    }
  }, [note.content, note.is_checklist, activeFontSize, activeFontCss]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, []);

  const triggerStealthCheck = (text: string, previousSafeContent: string) => {
    if (!onStealthCandidate) return;
    const trimmed = text.trim();
    if (trimmed.length < 4) return;
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const lastLine = lines.length > 0 ? lines[lines.length - 1] : "";

    const cleanup = () => {
      onChange({
        ...note,
        content: previousSafeContent,
        updated_at: new Date().toISOString(),
      });
    };

    if (lastLine.length >= 4 && lastLine !== trimmed) {
      onStealthCandidate(lastLine, cleanup);
    }
    onStealthCandidate(trimmed, cleanup);
  };

  const handleContentChange = (val: string) => {
    const prevSafe = lastSavedContentRef.current;
    onChange({
      ...note,
      content: val,
      updated_at: new Date().toISOString(),
    });

    if (onStealthCandidate) {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        triggerStealthCheck(val, prevSafe);
        lastSavedContentRef.current = val;
      }, 650);
    } else {
      lastSavedContentRef.current = val;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && onStealthCandidate) {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      triggerStealthCheck(note.content, lastSavedContentRef.current);
    }
  };

  const wrapSelection = (prefix: string, suffix: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = note.content.slice(start, end) || "texto";
    const next =
      note.content.slice(0, start) +
      prefix +
      selected +
      suffix +
      note.content.slice(end);
    handleContentChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
    });
  };

  const toggleChecklistMode = () => {
    if (!note.is_checklist) {
      const lines = note.content
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
      const text = note.checklist.map((c) => c.text).join("\n");
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
            title="Segure e arraste para mover a nota pela área de trabalho"
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
              title="Arraste para fora da janela para soltar na área de trabalho"
              onMouseDown={handleStartDragOut}
            >
              <GripVertical size={14} />
            </span>
          )
        )}
        <input
          className="note-title-input"
          placeholder="Título da nota..."
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
            title="Soltar nota na área de trabalho"
            onClick={(e) => onPopout(note, e.screenX - 150, e.screenY + 20)}
          >
            <ExternalLink size={13} />
          </button>
        )}
        <button
          className={`mini-btn ${note.pinned ? "active" : ""}`}
          title={
            note.pinned
              ? "Desafixar overlay da tela"
              : "Fixar como overlay na tela (sempre visível)"
          }
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
          title="Excluir nota"
          onClick={() => onDelete(note.id)}
        >
          <Trash2 size={13} />
        </button>
        {isPopout && onClosePopout && (
          <button
            className="mini-btn"
            title="Fechar nota flutuante"
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
                placeholder="Item da lista..."
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
            <Plus size={12} /> Adicionar item
          </button>
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          className="note-textarea"
          style={{ fontSize: activeFontSize, fontFamily: activeFontCss }}
          placeholder="Escreva sua anotação..."
          value={note.content}
          onChange={(e) => handleContentChange(e.target.value)}
          onKeyDown={handleKeyDown}
        />
      )}

      <div className="note-toolbar">
        <div className="note-toolbar-group">
          {!note.is_checklist && (
            <>
              <button
                className="mini-btn"
                title="Negrito"
                onClick={() => wrapSelection("**", "**")}
              >
                <strong>B</strong>
              </button>
              <button
                className="mini-btn"
                title="Itálico"
                onClick={() => wrapSelection("_", "_")}
              >
                <em>I</em>
              </button>
              <button
                className="mini-btn"
                title="Tachado"
                onClick={() => wrapSelection("~~", "~~")}
              >
                <s>S</s>
              </button>
              <button
                className="mini-btn"
                title="Sublinhado"
                onClick={() => wrapSelection("__", "__")}
              >
                <u>U</u>
              </button>
            </>
          )}
          <button
            className="mini-btn"
            title="Alternar lista de tarefas"
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
                  title="Diminuir letra"
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
                  title="Aumentar letra"
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
              title="Tamanho da letra"
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
              title="Escolher fonte do texto"
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
                  Trocar imagem / GIF
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
                  Remover fundo
                </button>
              </div>
            )}
            <button
              className={`mini-btn ${note.background_image ? "active" : ""}`}
              title="Personalizar com imagem (JPEG, PNG) ou GIF"
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
              title="Mudar cor da nota"
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
