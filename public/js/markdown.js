// Minimal, safe markdown for Tide AI answers: headings, paragraphs, bold,
// italics, inline and fenced code, links, lists and tables. Text is escaped
// first; only http(s) links are kept.

import { escapeHtml, safeUrl } from "./html.js";

const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s+/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/**
 * @param {string} url
 * @param {string} label
 */
function anchor(url, label) {
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
}

/** @param {string} text */
function inline(text) {
  // Code spans and links are swapped out for placeholders first so emphasis
  // rules can't reach inside them, then swapped back at the end.
  /** @type {string[]} */
  const stash = [];
  const keep = (/** @type {string} */ markup) => `\u0000${stash.push(markup) - 1}\u0000`;

  let s = text.replaceAll("\u0000", "");
  s = s.replace(/`([^`]+)`/g, (_m, code) => keep(`<code>${escapeHtml(code)}</code>`));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, href) => {
    const url = safeUrl(href);
    return url ? keep(anchor(url, label)) : label;
  });
  s = s.replace(/\bhttps?:\/\/[^\s<>()[\]]+[^\s<>()[\].,;:!?'"]/g, (url) => {
    const safe = safeUrl(url);
    return safe ? keep(anchor(safe, url)) : url;
  });
  s = escapeHtml(s);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^_\w])_([^_\s][^_]*?)_(?!\w)/g, "$1<em>$2</em>");
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i) => stash[Number(i)]);
}

/** @param {string} line */
function cells(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

/**
 * @param {string[]} lines
 * @param {number} i
 */
function isTable(lines, i) {
  return lines[i].includes("|") && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1]);
}

/**
 * @param {string[]} lines
 * @param {number} i
 */
function startsBlock(lines, i) {
  const line = lines[i];
  return /^```/.test(line) || /^#{1,4}\s/.test(line) || LIST_ITEM.test(line) || isTable(lines, i);
}

/** @param {string} source */
export function renderMarkdown(source) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  /** @type {string[]} */
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      const body = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      i++;
      out.push(`<pre><code>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = Math.min(heading[1].length + 2, 6);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    if (isTable(lines, i)) {
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      out.push(
        `<div class="table-wrap"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table></div>`,
      );
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items = [];
      while (i < lines.length && LIST_ITEM.test(lines[i])) items.push(inline(lines[i++].replace(LIST_ITEM, "")));
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.map((item) => `<li>${item}</li>`).join("")}</${tag}>`);
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    const para = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines, i)) para.push(lines[i++]);
    out.push(`<p>${para.map(inline).join("<br>")}</p>`);
  }
  return out.join("");
}
