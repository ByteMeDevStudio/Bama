// A tiny escaping template tag. Every interpolated value is HTML-escaped
// unless it is itself the result of html`` (or raw()), so data from ESPN or
// the AI can never inject markup.

class SafeHtml {
  /** @param {string} value */
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

/** @param {string} value */
export function raw(value) {
  return new SafeHtml(value);
}

/** @param {unknown} value */
export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** @param {unknown} value */
function render(value) {
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join("");
  if (value === null || value === undefined || value === false) return "";
  return escapeHtml(value);
}

/**
 * @param {TemplateStringsArray} strings
 * @param {...unknown} values
 */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}

/**
 * Only http(s) links survive; anything else (javascript:, data:) becomes null.
 * @param {string | null | undefined} url
 */
export function safeUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url, "https://invalid.example");
    if (parsed.origin === "https://invalid.example") return null;
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

/**
 * @param {Element} el
 * @param {SafeHtml} content
 */
export function mount(el, content) {
  el.innerHTML = content.value;
}
