import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createAllowlist } from "../src/security/ipAllowlist.js";
import { normalizeSchedule, normalizeSummary } from "../src/sources/espn.js";
import { UpstreamError } from "../src/lib/http.js";
import { fixture } from "./helpers.js";

const opts = { teamId: "333", provider: /** @type {const} */ ("espn") };

/**
 * Starts the real app on an ephemeral port with fake data sources.
 * @param {Record<string, string>} [env]
 * @param {typeof fetch} [fetchImpl]
 */
async function start(env = {}, fetchImpl) {
  const config = loadConfig({ ...env });
  const espn = /** @type {any} */ ({
    schedule: async (/** @type {number} */ season) => normalizeSchedule(fixture("espn-schedule.json"), null, { ...opts, season }),
    game: async (/** @type {string} */ id) => normalizeSummary(fixture("espn-summary.json"), opts),
    scoreboard: async () => ({ season: 2026, week: 6, events: [] }),
    rankings: async () => {
      throw new UpstreamError("ESPN", "HTTP 503", 503);
    },
    news: async () => [],
  });
  const chat = /** @type {any} */ ({
    async send(/** @type {any} */ { message, emit }) {
      emit({ type: "conversation", id: "c1" });
      emit({ type: "text", text: `echo: ${message}` });
      emit({ type: "done", stopReason: "end_turn" });
    },
  });
  const allowlist = createAllowlist({ ...config.security, log: () => {} });
  const app = createApp({
    config,
    espn,
    cfbd: /** @type {any} */ ({ configured: false }),
    chat,
    aiCredentials: false,
    allowlist,
    fetchImpl,
    now: () => new Date("2026-10-03T12:00:00Z"),
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("API endpoints, validation and security headers", async (t) => {
  const app = await start();
  t.after(app.close);

  const health = await fetch(`${app.base}/api/health`);
  assert.equal(health.status, 200);
  assert.match(health.headers.get("content-security-policy") ?? "", /script-src 'self'/);
  assert.equal(health.headers.get("x-frame-options"), "DENY");
  assert.equal(health.headers.get("x-powered-by"), null);

  const config = await (await fetch(`${app.base}/api/config`)).json();
  assert.equal(config.season, 2026);
  assert.equal(config.radio.configured, false);
  assert.equal(config.ai.credentials, false);

  const schedule = await (await fetch(`${app.base}/api/schedule`)).json();
  assert.equal(schedule.games.length, 3);
  assert.deepEqual(schedule.featured, { kind: "next", gameId: "401800003" });

  const game = await (await fetch(`${app.base}/api/games/401800004`)).json();
  assert.equal(game.home.abbreviation, "ALA");

  assert.equal((await fetch(`${app.base}/api/games/abc`)).status, 400);
  assert.equal((await fetch(`${app.base}/api/scoreboard?scope=everything`)).status, 400);
  assert.equal((await fetch(`${app.base}/api/schedule?season=1800`)).status, 400);

  const upstream = await fetch(`${app.base}/api/rankings`);
  assert.equal(upstream.status, 502);
  assert.match((await upstream.json()).error, /ESPN: HTTP 503/);

  assert.equal((await fetch(`${app.base}/api/nope`)).status, 404);
});

test("the web app is served", async (t) => {
  const app = await start();
  t.after(app.close);
  const res = await fetch(`${app.base}/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<title>Bama Hub<\/title>/);
  const js = await fetch(`${app.base}/js/app.js`);
  assert.equal(js.status, 200);
});

test("chat streams server-sent events", async (t) => {
  const app = await start();
  t.after(app.close);
  const res = await fetch(`${app.base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Roll Tide" }),
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
  const events = (await res.text())
    .split("\n\n")
    .filter(Boolean)
    .map((chunk) => JSON.parse(chunk.replace(/^data: /, "")));
  assert.deepEqual(events, [
    { type: "conversation", id: "c1" },
    { type: "text", text: "echo: Roll Tide" },
    { type: "done", stopReason: "end_turn" },
  ]);

  const bad = await fetch(`${app.base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: 42 }),
  });
  assert.equal(bad.status, 400);
});

test("radio relay only fetches the configured URL", async (t) => {
  /** @type {string[]} */
  const fetched = [];
  /** @type {typeof fetch} */
  const fetchImpl = async (url) => {
    fetched.push(String(url));
    return new Response(new Uint8Array([0xff, 0xfb, 0x90, 0x00]), { status: 200, headers: { "Content-Type": "audio/mpeg" } });
  };
  const off = await start();
  t.after(off.close);
  assert.equal((await fetch(`${off.base}/api/radio/stream`)).status, 404);

  const on = await start({ RADIO_STREAM_URL: "https://radio.example/live.mp3" }, fetchImpl);
  t.after(on.close);
  const res = await fetch(`${on.base}/api/radio/stream?url=https://evil.example/`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "audio/mpeg");
  assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [0xff, 0xfb, 0x90, 0x00]);
  assert.deepEqual(fetched, ["https://radio.example/live.mp3"]);
});

test("behind a trusted proxy, forwarded clients that aren't juno get a 403", async (t) => {
  const app = await start({ TRUST_PROXY: "1", ALLOWED_IPS: "192.168.1.20" });
  t.after(app.close);
  const stranger = await fetch(`${app.base}/api/health`, { headers: { "X-Forwarded-For": "203.0.113.5" } });
  assert.equal(stranger.status, 403);
  assert.equal(await stranger.text(), "Forbidden");
  const juno = await fetch(`${app.base}/api/health`, { headers: { "X-Forwarded-For": "192.168.1.20" } });
  assert.equal(juno.status, 200);
});

test("config: TRUST_PROXY=true trusts one hop, and bad effort values fall back", () => {
  assert.equal(loadConfig({ TRUST_PROXY: "true" }).security.trustProxy, 1);
  assert.equal(loadConfig({ TRUST_PROXY: "" }).security.trustProxy, false);
  assert.equal(loadConfig({ TRUST_PROXY: "2" }).security.trustProxy, 2);
  assert.deepEqual(loadConfig({ TRUST_PROXY: "10.0.0.1, 10.0.0.2" }).security.trustProxy, ["10.0.0.1", "10.0.0.2"]);
  assert.equal(loadConfig({ CLAUDE_EFFORT: "HIGH" }).ai.effort, "high");
  assert.equal(loadConfig({ CLAUDE_EFFORT: "turbo" }).ai.effort, "medium");
  assert.equal(loadConfig({}).host, "127.0.0.1");
  assert.equal(loadConfig({ WATCH_PROVIDER: "netflix" }).watch.provider, "espn");
});
