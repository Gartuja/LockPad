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
  let tag = el.tagName.toUpperCase();

  // Convert Chromium's <span style="..."> formatting into clean semantic tags
  if (tag === "SPAN") {
    const frag = outDoc.createDocumentFragment();
    let target: Node = frag;
    const st = el.getAttribute("style") ?? "";
    const wrapTags: string[] = [];
    if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(st)) wrapTags.push("b");
    if (/font-style\s*:\s*italic/i.test(st)) wrapTags.push("i");
    if (/text-decoration[^;]*underline/i.test(st)) wrapTags.push("u");
    if (/text-decoration[^;]*line-through/i.test(st)) wrapTags.push("s");

    for (const wt of wrapTags) {
      const wEl = outDoc.createElement(wt);
      target.appendChild(wEl);
      target = wEl;
    }
    el.childNodes.forEach((child) => {
      const clean = sanitizeNode(child, outDoc);
      if (clean) target.appendChild(clean);
    });
    return frag;
  }

  if (tag === "STRONG") tag = "B";
  if (tag === "EM") tag = "I";
  if (tag === "STRIKE" || tag === "DEL") tag = "S";

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
  const looksLikeHtml = /<(b|strong|i|em|u|s|strike|del|span|br|p|div)\b[^>]*>/i.test(raw);
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
  const looksLikeHtml = /<(b|strong|i|em|u|s|strike|del|span|br|p|div)\b[^>]*>/i.test(raw);
  if (!looksLikeHtml) return raw.replace(/\u200B/g, "");

  const div = document.createElement("div");
  div.innerHTML = sanitizeNoteHtml(raw);
  div.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  div.querySelectorAll("div, p").forEach((block) => {
    if (block.previousSibling) {
      block.prepend("\n");
    }
  });
  return (div.textContent ?? "").replace(/\u200B/g, "").replace(/\r\n/g, "\n");
}

export type FormatCmd = "bold" | "italic" | "strikeThrough" | "underline";

const CMD_TAGS: Record<FormatCmd, string[]> = {
  bold: ["B", "STRONG"],
  italic: ["I", "EM"],
  strikeThrough: ["S", "STRIKE", "DEL"],
  underline: ["U"],
};

function findMatchingAncestors(
  editor: HTMLElement,
  node: Node | null,
  tags: string[]
): HTMLElement[] {
  const result: HTMLElement[] = [];
  let cur: Node | null = node;
  while (cur && cur !== editor) {
    if (cur.nodeType === Node.ELEMENT_NODE) {
      const el = cur as HTMLElement;
      if (tags.includes(el.tagName.toUpperCase())) {
        result.push(el);
      }
    }
    cur = cur.parentNode;
  }
  return result;
}

export function queryFormatState(editor: HTMLElement | null, cmd: FormatCmd): boolean {
  if (!editor) return false;
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
    const ancestors = findMatchingAncestors(editor, sel.anchorNode, CMD_TAGS[cmd]);
    if (ancestors.length > 0) return true;
  }
  try {
    return document.queryCommandState(cmd);
  } catch {
    return false;
  }
}

function unwrapElement(el: HTMLElement) {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) {
    parent.insertBefore(el.firstChild, el);
  }
  parent.removeChild(el);
}

/**
 * Reliably toggles Bold, Italic, Strikethrough, and Underline even when combined (e.g. S + U)
 * or when Chromium's native execCommand fails to untoggle nested tags.
 */
export function toggleEditorFormat(editor: HTMLElement, cmd: FormatCmd): void {
  const tags = CMD_TAGS[cmd];
  try {
    document.execCommand("styleWithCSS", false, "false");
  } catch {
    // Ignore on engines that don't support styleWithCSS
  }

  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !editor.contains(sel.anchorNode)) {
    editor.focus();
  }

  const wasActive = queryFormatState(editor, cmd);
  document.execCommand(cmd, false);

  // If it was active and Chromium failed to untoggle (common with S and U nested or collapsed)
  if (wasActive && queryFormatState(editor, cmd)) {
    const selNow = window.getSelection();
    if (selNow && selNow.rangeCount > 0 && editor.contains(selNow.anchorNode)) {
      const range = selNow.getRangeAt(0);
      if (range.collapsed) {
        // Move cursor outside the matching ancestor tag by splitting or escaping after it
        const ancestors = findMatchingAncestors(editor, range.startContainer, tags);
        if (ancestors.length > 0) {
          const topTarget = ancestors[ancestors.length - 1];
          // Split content after cursor into a sibling clone, leaving a clean exit point
          const afterRange = document.createRange();
          afterRange.setStart(range.startContainer, range.startOffset);
          afterRange.setEndAfter(topTarget);
          const afterFrag = afterRange.extractContents();

          const zwsp = document.createTextNode("\u200B");
          topTarget.parentNode?.insertBefore(zwsp, topTarget.nextSibling);
          if (afterFrag.textContent && afterFrag.textContent.length > 0) {
            topTarget.parentNode?.insertBefore(afterFrag, zwsp.nextSibling);
          }

          const newRange = document.createRange();
          newRange.setStart(zwsp, 1);
          newRange.collapse(true);
          selNow.removeAllRanges();
          selNow.addRange(newRange);
        }
      } else {
        // Unwrap all matching elements overlapping the selected range
        const matchingInside = Array.from(editor.querySelectorAll(tags.join(","))).filter(
          (node) => range.intersectsNode(node)
        ) as HTMLElement[];
        if (matchingInside.length > 0) {
          matchingInside.forEach(unwrapElement);
        } else {
          const ancestors = findMatchingAncestors(editor, range.commonAncestorContainer, tags);
          ancestors.forEach(unwrapElement);
        }
      }
    }
  }
}
