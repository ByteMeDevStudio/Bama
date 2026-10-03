// The local Alabama football reference shelf (data/knowledge/*.md), split into
// sections and searched with simple BM25 keyword ranking. Add or edit markdown
// files there to teach the assistant more; they're re-read at startup.

import fs from "node:fs/promises";
import path from "node:path";

const STOP_WORDS = new Set(
  "a an and are as at be by did do does for from has have how i in is it its of on or the to was were what when where which who why will with".split(
    " ",
  ),
);

/** @param {string} text */
export function tokenize(text) {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

/**
 * @typedef {{ source: string, heading: string, text: string, tokens: string[] }} Section
 */

/**
 * Splits markdown on #/##/### headings; each section keeps its heading path.
 * @param {string} source
 * @param {string} markdown
 * @returns {Section[]}
 */
export function splitSections(source, markdown) {
  /** @type {Section[]} */
  const sections = [];
  /** @type {string[]} */
  const trail = [];
  /** @type {string[]} */
  let lines = [];

  const flush = () => {
    const text = lines.join("\n").trim();
    if (text) {
      const heading = trail.filter(Boolean).join(" › ");
      sections.push({ source, heading, text, tokens: tokenize(`${heading} ${heading} ${text}`) });
    }
    lines = [];
  };

  for (const line of markdown.split(/\r?\n/)) {
    const m = /^(#{1,3})\s+(.*)$/.exec(line);
    if (m) {
      flush();
      const level = m[1].length;
      trail.length = level - 1;
      trail[level - 1] = m[2].trim();
    } else {
      lines.push(line);
    }
  }
  flush();
  return sections;
}

/** @param {Section[]} sections */
export function createKnowledgeIndex(sections) {
  const n = sections.length;
  const avgLen = sections.reduce((sum, s) => sum + s.tokens.length, 0) / Math.max(n, 1);
  /** @type {Map<string, number>} */
  const docFreq = new Map();
  for (const s of sections) {
    for (const t of new Set(s.tokens)) docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
  }

  return {
    size: n,
    /**
     * @param {string} query
     * @param {number} [limit]
     */
    search(query, limit = 4) {
      const terms = [...new Set(tokenize(query))];
      if (terms.length === 0) return [];
      const k1 = 1.4;
      const b = 0.75;
      return sections
        .map((s) => {
          let score = 0;
          for (const term of terms) {
            const tf = s.tokens.filter((t) => t === term).length;
            if (!tf) continue;
            const df = docFreq.get(term) ?? 0;
            const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
            score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * s.tokens.length) / avgLen)));
          }
          return { section: s, score };
        })
        .filter((r) => r.score > 0)
        .sort((a, b2) => b2.score - a.score)
        .slice(0, limit)
        .map(({ section, score }) => ({
          source: section.source,
          heading: section.heading,
          text: section.text,
          score: Math.round(score * 100) / 100,
        }));
    },
  };
}

/** @param {string} dir */
export async function loadKnowledge(dir) {
  /** @type {Section[]} */
  const sections = [];
  let files = [];
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith(".md")).sort();
  } catch {
    return createKnowledgeIndex([]);
  }
  for (const file of files) {
    const markdown = await fs.readFile(path.join(dir, file), "utf8");
    sections.push(...splitSections(file, markdown));
  }
  return createKnowledgeIndex(sections);
}

/** @typedef {ReturnType<typeof createKnowledgeIndex>} KnowledgeIndex */
