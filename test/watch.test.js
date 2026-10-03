import test from "node:test";
import assert from "node:assert/strict";
import { normalizeNetwork, watchOptions } from "../src/watch.js";

test("network names are normalized", () => {
  assert.equal(normalizeNetwork("SEC Network"), "SECN");
  assert.equal(normalizeNetwork("espn+"), "ESPN+");
  assert.equal(normalizeNetwork(" abc "), "ABC");
});

test("ABC: free antenna first, then your provider, then the ESPN app", () => {
  const options = watchOptions({ id: "401", broadcasts: ["ABC"] }, "hulu");
  assert.deepEqual(
    options.map((o) => o.kind),
    ["free", "subscription", "subscription"],
  );
  assert.match(options[0].label, /^Over the air on ABC$/);
  assert.match(options[1].label, /Hulu \+ Live TV: ABC/);
  assert.equal(options[2].url, "https://www.espn.com/college-football/game/_/gameId/401");
});

test("streaming-only games don't suggest a live-TV provider", () => {
  const options = watchOptions({ id: "402", broadcasts: ["SEC Network+"] }, "youtubetv");
  assert.equal(options.length, 1);
  assert.match(options[0].label, /SEC Network\+/);
});

test("antenna households get no provider link", () => {
  const options = watchOptions({ id: "403", broadcasts: ["ESPN"] }, "antenna");
  assert.deepEqual(
    options.map((o) => o.label),
    ["ESPN app"],
  );
});

test("unknown or unannounced networks still point somewhere useful", () => {
  assert.equal(watchOptions({ id: "404", broadcasts: [] }, "espn")[0].kind, "info");
  const odd = watchOptions({ id: "405", broadcasts: ["Big Local TV"] }, "espn");
  assert.match(odd[0].label, /Find BIG LOCAL TV/);
});
