const ALLOWED_TAGS = new Set([
  "B",
  "STRONG",
  "I",
  "EM",
  "U",
  "S",
  "STRIKE",
  "DEL",
  "BR",
  "P",
  "DIV",
]);

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function sanitizeNode(node: Node, outDoc: Document): Node | null {
  if (node.nodeType === Node.TEXT_NODE) {
    return outDoc.createTextNode(node.textContent ?? "");
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }
  const el = node as HTMLElement;
  const tag = el.tagName.toUpperCase();
  if (!ALLOWED_TAGS.has(tag)) {
    const frag = outDoc.createDocumentFragment();
    el.childNodes.forEach((child) => {
      const clean = sanitizeNode(child, outDoc);
      if (clean) frag.appendChild(clean);
    });
    return frag;
  }
  const cleanEl = outDoc.createElement(tag.toLowerCase());
  el.childNodes.forEach((child) => {
    const clean = sanitizeNode(child, outDoc);
    if (clean) cleanEl.appendChild(clean);
  });
  return cleanEl;
}

/**
 * Sanitizes note HTML to strictly allow formatting tags (B, I, U, S, BR, P, DIV)
 * with zero attributes, preventing any XSS injection.
 */
export function sanitizeNoteHtml(raw: string): string {
  if (!raw) return "";
  // Plain text stored before rich-text upgrade: preserve newlines as <br>
  const looksLikeHtml = /<(b|strong|i|em|u|s|strike|del|br|p|div)\b[^>]*>/i.test(raw);
  if (!looksLikeHtml) {
    return escapeHtml(raw).replace(/\r?\n/g, "<br>");
  }

  const parser = new DOMParser();
  const parsed = parser.parseFromString(`<div>${raw}</div>`, "text/html");
  const outDoc = document.implementation.createHTMLDocument("");
  const container = outDoc.createElement("div");

  const root = parsed.body.firstElementChild;
  if (root) {
    root.childNodes.forEach((child) => {
      const clean = sanitizeNode(child, outDoc);
      if (clean) container.appendChild(clean);
    });
  }
  return container.innerHTML;
}

/**
 * Extracts clean plain text (preserving line breaks) from rich-text note HTML.
 */
export function htmlToPlainText(raw: string): string {
  if (!raw) return "";
  const looksLikeHtml = /<(b|strong|i|em|u|s|strike|del|br|p|div)\b[^>]*>/i.test(raw);
  if (!looksLikeHtml) return raw;

  const div = document.createElement("div");
  div.innerHTML = sanitizeNoteHtml(raw);
  div.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  div.querySelectorAll("div, p").forEach((block) => {
    if (block.previousSibling) {
      block.prepend("\n");
    }
  });
  return (div.textContent ?? "").replace(/\r\n/g, "\n");
}
