// JSON API for the web app, plus the chat stream and radio relay.

import { Readable } from "node:stream";
import express from "express";
import { z } from "zod";
import { UpstreamError } from "../lib/http.js";
import { currentSeason } from "../lib/season.js";
import { featuredGame } from "../sources/espn.js";
import { ChatError } from "../ai/chat.js";
import { PROVIDER_LINKS } from "../watch.js";

const scheduleQuery = z.object({ season: z.coerce.number().int().min(2000).max(2100).optional() });
const scoreboardQuery = z.object({
  league: z.enum(["college-football", "nfl"]).optional(),
  scope: z.enum(["top25", "sec", "fbs"]).optional(),
  date: z.string().regex(/^\d{8}$/).optional(),
  week: z.coerce.number().int().min(1).max(20).optional(),
  season: z.coerce.number().int().min(2000).max(2100).optional(),
});
const newsQuery = z.object({ limit: z.coerce.number().int().min(1).max(30).optional() });
const chatBody = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string(),
});

/**
 * @param {{
 *   config: import("../config.js").Config,
 *   espn: import("../sources/espn.js").EspnClient,
 *   cfbd: import("../sources/cfbd.js").CfbdClient,
 *   chat: import("../ai/chat.js").ChatService,
 *   aiCredentials: boolean,
 *   fetchImpl?: typeof fetch,
 *   now?: () => Date,
 * }} deps
 */
export function createApiRouter({ config, espn, cfbd, chat, aiCredentials, fetchImpl = fetch, now = () => new Date() }) {
  const router = express.Router();
  router.use(express.json({ limit: "16kb" }));

  /**
   * @param {(req: import("express").Request, res: import("express").Response) => Promise<unknown>} fn
   * @returns {import("express").RequestHandler}
   */
  const handle = (fn) => async (req, res, next) => {
    try {
      const body = await fn(req, res);
      if (body !== undefined && !res.headersSent) res.json(body);
    } catch (err) {
      next(err);
    }
  };

  router.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  router.get(
    "/config",
    handle(async () => ({
      season: currentSeason(now()),
      timeZone: config.timeZone,
      watch: {
        provider: config.watch.provider,
        providerLabel: PROVIDER_LINKS[config.watch.provider]?.label ?? null,
      },
      radio: {
        configured: Boolean(config.radio.streamUrl),
        proxied: config.radio.proxy,
        // Without the relay the browser has to fetch the stream itself.
        directUrl: config.radio.proxy ? null : config.radio.streamUrl || null,
      },
      ai: { credentials: aiCredentials, webSearch: config.ai.webSearch },
      cfbd: { configured: cfbd.configured },
    })),
  );

  router.get(
    "/schedule",
    handle(async (req) => {
      const { season } = scheduleQuery.parse(req.query);
      const schedule = await espn.schedule(season ?? currentSeason(now()));
      const featured = featuredGame(schedule.games, now());
      return { ...schedule, featured: featured && { kind: featured.kind, gameId: featured.game.id } };
    }),
  );

  router.get(
    "/games/:id",
    handle(async (req) => {
      const id = String(req.params.id);
      if (!/^\d{1,15}$/.test(id)) throw new RangeError("Invalid game id");
      return espn.game(id);
    }),
  );

  router.get(
    "/scoreboard",
    handle(async (req) => espn.scoreboard(scoreboardQuery.parse(req.query))),
  );

  router.get(
    "/rankings",
    handle(async () => espn.rankings()),
  );

  router.get(
    "/news",
    handle(async (req) => espn.news(newsQuery.parse(req.query).limit ?? 12)),
  );

  // Relays the configured radio stream so the browser can treat it as
  // same-origin audio (needed for the TV-sync delay). Only the URL from .env
  // is ever fetched; the browser can't choose what this requests.
  router.get("/radio/stream", async (req, res) => {
    if (!config.radio.streamUrl || !config.radio.proxy) {
      res.status(404).json({ error: "No radio stream is configured." });
      return;
    }
    const abort = new AbortController();
    res.on("close", () => abort.abort());
    let upstream;
    try {
      upstream = await fetchImpl(config.radio.streamUrl, {
        headers: { "User-Agent": "bama-hub/0.1", "Icy-MetaData": "0" },
        signal: abort.signal,
      });
    } catch {
      if (!res.headersSent) res.status(502).json({ error: "Couldn't reach the radio stream." });
      return;
    }
    if (!upstream.ok || !upstream.body) {
      res.status(502).json({ error: `Radio stream returned HTTP ${upstream.status}.` });
      return;
    }
    res.status(200);
    res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    const body = Readable.fromWeb(/** @type {import("node:stream/web").ReadableStream} */ (upstream.body));
    body.on("error", () => res.destroy());
    body.pipe(res);
  });

  // Tide AI. Responds with a server-sent event stream of ChatEvents.
  router.post("/chat", async (req, res) => {
    const parsed = chatBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Send { message, conversationId? }." });
      return;
    }
    const abort = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) abort.abort();
    });

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    /** @param {import("../ai/chat.js").ChatEvent} event */
    const emit = (event) => {
      if (!res.writableEnded && !res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    try {
      await chat.send({ ...parsed.data, emit, signal: abort.signal });
    } catch (err) {
      const message = err instanceof ChatError ? err.message : "Something went wrong.";
      if (!(err instanceof ChatError)) console.error("[chat]", err);
      emit({ type: "error", message });
    }
    res.end();
  });

  router.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  /** @type {import("express").ErrorRequestHandler} */
  const onError = (err, _req, res, _next) => {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: z.prettifyError(err) });
    } else if (err instanceof RangeError) {
      res.status(400).json({ error: err.message });
    } else if (err instanceof UpstreamError) {
      res.status(502).json({ error: err.message });
    } else {
      console.error(err);
      res.status(500).json({ error: "Internal error" });
    }
  };
  router.use(onError);

  return router;
}
