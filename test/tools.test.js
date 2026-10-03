import test from "node:test";
import assert from "node:assert/strict";
import { createToolkit, toResultText } from "../src/ai/tools.js";
import { createEspnClient } from "../src/sources/espn.js";
import { createCfbdClient } from "../src/sources/cfbd.js";
import { createKnowledgeIndex, splitSections } from "../src/sources/knowledge.js";
import { TtlCache } from "../src/lib/cache.js";
import { fakeFetch, fixture } from "./helpers.js";

function toolkit({ webSearch = true, cfbdKey = "k" } = {}) {
  const fetchImpl = fakeFetch({
    "/teams/333/schedule?season=2026&seasontype=2": fixture("espn-schedule.json"),
    "/teams/333/schedule?season=2026&seasontype=3": { events: [] },
    "/summary?event=401800004": fixture("espn-summary.json"),
    "/records": [{ year: 2025, team: "Alabama" }],
  });
  const cache = new TtlCache();
  return createToolkit({
    espn: createEspnClient({ fetchImpl, cache, teamId: "333", provider: "espn" }),
    cfbd: createCfbdClient({ fetchImpl, cache, apiKey: cfbdKey, baseUrl: "https://cfbd.test" }),
    knowledge: createKnowledgeIndex(splitSections("k.md", "# Iron Bowl\nKick Six in 2013.")),
    webSearch,
    now: () => new Date("2026-10-03T15:00:00Z"),
  });
}

test("toResultText trims long arrays and says so", () => {
  const rows = Array.from({ length: 500 }, (_, i) => ({ i, pad: "x".repeat(50) }));
  const text = toResultText(rows, 5000);
  assert.ok(text.length <= 5000);
  const parsed = JSON.parse(text);
  assert.match(parsed.note, /Showing the first \d+ of 500/);
  assert.ok(parsed.results.length > 10);
  assert.equal(toResultText({ a: 1 }), '{"a":1}');
});

test("tool definitions are valid JSON Schema tools", () => {
  const { definitions } = toolkit();
  const names = definitions.map((d) => d.name);
  assert.deepEqual(names, [
    "get_alabama_schedule",
    "get_scoreboard",
    "get_game_details",
    "get_rankings",
    "get_alabama_news",
    "college_football_data",
    "search_bama_knowledge",
    "web_search",
  ]);
  for (const def of definitions.slice(0, -1)) {
    const d = /** @type {any} */ (def);
    assert.equal(d.input_schema.type, "object");
    assert.equal(d.input_schema.$schema, undefined);
    assert.equal(d.input_schema.additionalProperties, false);
    assert.equal(d.eager_input_streaming, true);
    assert.ok(d.description.length > 20);
  }
  assert.deepEqual(definitions.at(-1), { type: "web_search_20260209", name: "web_search", max_uses: 5 });
  assert.equal(toolkit({ webSearch: false }).definitions.length, 7);
});

test("definitions are deterministic (prompt caching depends on it)", () => {
  assert.equal(JSON.stringify(toolkit().definitions), JSON.stringify(toolkit().definitions));
});

test("run() validates input and never throws", async () => {
  const { run } = toolkit();
  assert.deepEqual(await run("nope", {}), { content: "Unknown tool: nope", isError: true });

  const bad = await run("get_game_details", { game_id: "abc" });
  assert.equal(bad.isError, true);
  assert.match(bad.content, /Invalid input/);

  const extra = await run("get_alabama_schedule", { season: 2026, hack: true });
  assert.equal(extra.isError, true);

  const wrongParam = await run("college_football_data", { endpoint: "/records", params: { searchTerm: "x" } });
  assert.equal(wrongParam.isError, true);
  assert.match(wrongParam.content, /does not accept: searchTerm/);
});

test("schedule tool returns compact games for the current season", async () => {
  const { run } = toolkit();
  const result = await run("get_alabama_schedule", {});
  assert.equal(result.isError, false);
  const data = JSON.parse(result.content);
  assert.equal(data.season, 2026);
  assert.equal(data.record, "4-1");
  assert.equal(data.games.length, 3);
  assert.deepEqual(data.games[0].alabamaResult, { outcome: "W", score: "42-10" });
  assert.equal(data.games[0].away.team, "Northern Illinois Huskies");
  assert.equal(data.games[0].watch, undefined, "UI-only fields are left out");
});

test("game details, CFBD and knowledge tools", async () => {
  const { run } = toolkit();
  const game = JSON.parse((await run("get_game_details", { game_id: "401800004" })).content);
  assert.deepEqual(game.winProbability, { home: 74.2, away: 25.8 });
  assert.equal(game.teamStats[0].stat, "1st Downs");
  assert.match(game.source, /gameId\/401800004/);

  const records = JSON.parse((await run("college_football_data", { endpoint: "/records", params: { year: 2025, team: "Alabama" } })).content);
  assert.equal(records[0].team, "Alabama");

  const kb = JSON.parse((await run("search_bama_knowledge", { query: "kick six" })).content);
  assert.equal(kb[0].heading, "Iron Bowl");
  const none = JSON.parse((await run("search_bama_knowledge", { query: "zzzz qqqq" })).content);
  assert.match(none.note, /No matching entries/);
});

test("a missing CFBD key comes back as a readable tool error", async () => {
  const { run } = toolkit({ cfbdKey: "" });
  const res = await run("college_football_data", { endpoint: "/records", params: { year: 2025 } });
  assert.equal(res.isError, true);
  assert.match(res.content, /CFBD_API_KEY/);
});
