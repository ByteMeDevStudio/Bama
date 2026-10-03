import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createKnowledgeIndex, loadKnowledge, splitSections, tokenize } from "../src/sources/knowledge.js";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "knowledge");

test("tokenize drops stop words and punctuation", () => {
  assert.deepEqual(tokenize("Who won the 2013 Iron Bowl?"), ["won", "2013", "iron", "bowl"]);
  assert.deepEqual(tokenize("Bryant–Denny"), ["bryant", "denny"]);
});

test("sections keep their heading trail", () => {
  const sections = splitSections("x.md", "# Top\nintro\n## Rivals\n### Auburn\nIron Bowl text\n## Other\nmore");
  assert.deepEqual(
    sections.map((s) => s.heading),
    ["Top", "Top › Rivals › Auburn", "Top › Other"],
  );
});

test("search ranks the most relevant section first", () => {
  const index = createKnowledgeIndex([
    ...splitSections("a.md", "# Coaches\nBear Bryant won six titles.\n# Stadium\nBryant-Denny holds 100,077."),
    ...splitSections("b.md", "# Iron Bowl\nThe Kick Six happened in 2013."),
  ]);
  assert.equal(index.search("kick six")[0].heading, "Iron Bowl");
  assert.equal(index.search("stadium capacity")[0].heading, "Stadium");
  assert.deepEqual(index.search("the of and"), []);
});

test("the shipped knowledge base answers the basics", async () => {
  const kb = await loadKnowledge(dataDir);
  assert.ok(kb.size > 10);
  assert.match(kb.search("Kick Six Iron Bowl")[0].text, /Chris Davis/);
  assert.match(kb.search("Heisman Trophy winners")[0].text, /Derrick Henry/);
  assert.match(kb.search("national championships")[0].text, /18 national championships/);
  assert.match(kb.search("antenna ABC free")[0].text, /antenna/i);
});

test("a missing directory just means an empty index", async () => {
  const kb = await loadKnowledge(path.join(dataDir, "nope"));
  assert.equal(kb.size, 0);
  assert.deepEqual(kb.search("anything"), []);
});
