import test from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "../public/js/markdown.js";
import { html, raw, safeUrl } from "../public/js/html.js";

test("escapes HTML from the model", () => {
  const out = renderMarkdown('<script>alert(1)</script> <img src=x onerror="alert(1)">');
  assert.ok(!out.includes("<script>"));
  assert.ok(!out.includes("<img"));
  assert.match(out, /&lt;script&gt;/);
});

test("only http(s) links become anchors", () => {
  assert.match(renderMarkdown("[ESPN](https://espn.com/a?b=1&c=2)"), /<a href="https:\/\/espn\.com\/a\?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">ESPN<\/a>/);
  const js = renderMarkdown("[click](javascript:alert(1))");
  assert.ok(!js.includes("<a"), js);
  assert.match(renderMarkdown("see https://rolltide.com."), /<a href="https:\/\/rolltide\.com\/"[^>]*>https:\/\/rolltide\.com<\/a>\./);
});

test("emphasis doesn't leak into link URLs", () => {
  const out = renderMarkdown("[x](https://e.com/_a_b_) and _this_");
  assert.match(out, /href="https:\/\/e\.com\/_a_b_"/);
  assert.match(out, /<em>this<\/em>/);
});

test("tables, lists, headings, code", () => {
  const out = renderMarkdown(
    "## Box\n| Team | Yds |\n|---|---:|\n| ALA | 331 |\n| AUB | 240 |\n\n- **Bold** item\n- `code`\n\n1. first\n2. second\n\n```\n<b>raw</b>\n```",
  );
  assert.match(out, /<h4>Box<\/h4>/);
  assert.match(out, /<th>Team<\/th><th>Yds<\/th>/);
  assert.match(out, /<td>ALA<\/td><td>331<\/td>/);
  assert.match(out, /<ul><li><strong>Bold<\/strong> item<\/li><li><code>code<\/code><\/li><\/ul>/);
  assert.match(out, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
  assert.match(out, /<pre><code>&lt;b&gt;raw&lt;\/b&gt;<\/code><\/pre>/);
});

test("html template escapes values but keeps nested templates", () => {
  const name = '"><script>';
  const out = html`<a title="${name}">${html`<b>${name}</b>`}${raw("<i>ok</i>")}</a>`;
  assert.equal(String(out), '<a title="&quot;&gt;&lt;script&gt;"><b>&quot;&gt;&lt;script&gt;</b><i>ok</i></a>');
  assert.equal(String(html`${null}${undefined}${false}${0}`), "0");
});

test("safeUrl", () => {
  assert.equal(safeUrl("https://a.espncdn.com/x.png"), "https://a.espncdn.com/x.png");
  assert.equal(safeUrl("javascript:alert(1)"), null);
  assert.equal(safeUrl("/relative"), null);
  assert.equal(safeUrl(null), null);
});
