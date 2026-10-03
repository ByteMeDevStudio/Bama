import test from "node:test";
import assert from "node:assert/strict";
import { buildCfbdQuery, createCfbdClient } from "../src/sources/cfbd.js";
import { TtlCache } from "../src/lib/cache.js";
import { fakeFetch } from "./helpers.js";

test("only allowlisted params reach CFBD", () => {
  assert.equal(buildCfbdQuery("/teams/matchup", { team1: "Alabama", team2: "Auburn", minYear: 1990 }), "team1=Alabama&team2=Auburn&minYear=1990");
  assert.equal(buildCfbdQuery("/games", { year: 2025, team: "Alabama", week: undefined, seasonType: "" }), "year=2025&team=Alabama");
  assert.throws(() => buildCfbdQuery("/games", { year: 2025, searchTerm: "x" }), /does not accept: searchTerm/);
  assert.throws(() => buildCfbdQuery(/** @type {any} */ ("/admin"), {}), /Unsupported endpoint/);
});

test("client sends the bearer key and explains a missing key", async () => {
  const fetchImpl = fakeFetch({ "/records": [{ year: 2025, team: "Alabama", total: { wins: 11, losses: 4 } }] });
  const cfbd = createCfbdClient({ fetchImpl, cache: new TtlCache(), apiKey: "secret", baseUrl: "https://api.collegefootballdata.com" });
  const rows = await cfbd.query("/records", { year: 2025, team: "Alabama" });
  assert.equal(rows[0].team, "Alabama");
  assert.equal(fetchImpl.calls[0].url, "https://api.collegefootballdata.com/records?year=2025&team=Alabama");
  assert.equal(/** @type {any} */ (fetchImpl.calls[0].init?.headers).Authorization, "Bearer secret");

  const noKey = createCfbdClient({ fetchImpl, cache: new TtlCache(), apiKey: "", baseUrl: "https://x" });
  assert.equal(noKey.configured, false);
  await assert.rejects(noKey.query("/records", { year: 2025 }), /CFBD_API_KEY/);
});
