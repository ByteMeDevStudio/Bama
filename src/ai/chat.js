// Tide AI conversations: a streaming tool-use loop against the Claude API.
//
// History is append-only and kept server-side. Assistant turns are stored
// exactly as returned (thinking blocks included) and the system prompt and
// tool list never change, which keeps prompt caching effective and keeps
// replayed thinking blocks valid.

import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT, dateContext } from "./prompt.js";
import { TOOL_STATUS } from "./tools.js";

/** @typedef {import("@anthropic-ai/sdk").Anthropic.Beta.BetaMessageParam} MessageParam */
/** @typedef {import("@anthropic-ai/sdk").Anthropic.Beta.BetaToolResultBlockParam} ToolResultParam */
/** @typedef {import("@anthropic-ai/sdk").Anthropic.Beta.BetaToolUseBlock} ToolUseBlock */
/**
 * @typedef {{ type: "conversation", id: string }
 *   | { type: "text", text: string }
 *   | { type: "status", text: string }
 *   | { type: "done", stopReason: string | null }
 *   | { type: "error", message: string }} ChatEvent
 */

// Server-side refusal fallback: if a safety classifier declines a request, the
// API retries it on Anthropic's recommended fallback model instead of failing.
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const MAX_STEPS = 10;
const MAX_JSON_RETRIES = 2;
const CONVERSATION_TTL_MS = 12 * 3600_000;
const MAX_CONVERSATIONS = 100;

export class ChatError extends Error {
  /**
   * @param {number} status
   * @param {string} message
   */
  constructor(status, message) {
    super(message);
    this.name = "ChatError";
    this.status = status;
  }
}

/**
 * @param {{
 *   client: Pick<Anthropic, "beta">,
 *   toolkit: import("./tools.js").Toolkit,
 *   model: string,
 *   effort: "low" | "medium" | "high" | "xhigh" | "max",
 *   timeZone: string,
 *   maxTurns: number,
 *   rateLimitPerHour: number,
 *   now?: () => Date,
 *   log?: (msg: string) => void,
 * }} options
 */
export function createChatService({
  client,
  toolkit,
  model,
  effort,
  timeZone,
  maxTurns,
  rateLimitPerHour,
  now = () => new Date(),
  log = (msg) => console.error(msg),
}) {
  /** @type {Map<string, { messages: MessageParam[], turns: number, busy: boolean, updatedAt: number }>} */
  const conversations = new Map();
  /** @type {number[]} */
  const recentRequests = [];

  function prune() {
    const cutoff = now().getTime() - CONVERSATION_TTL_MS;
    for (const [id, c] of conversations) {
      if (!c.busy && c.updatedAt < cutoff) conversations.delete(id);
    }
    while (conversations.size > MAX_CONVERSATIONS) {
      const oldest = [...conversations.entries()]
        .filter(([, c]) => !c.busy)
        .sort((a, b) => a[1].updatedAt - b[1].updatedAt)[0];
      if (!oldest) break;
      conversations.delete(oldest[0]);
    }
  }

  function checkRateLimit() {
    const hourAgo = now().getTime() - 3600_000;
    while (recentRequests.length && recentRequests[0] < hourAgo) recentRequests.shift();
    if (recentRequests.length >= rateLimitPerHour) {
      throw new ChatError(429, "Tide AI has hit its hourly message limit. Try again a bit later.");
    }
    recentRequests.push(now().getTime());
  }

  /**
   * One streamed model call. Text deltas go straight to the browser; tool
   * calls show up as status lines.
   * @param {MessageParam[]} messages
   * @param {(event: ChatEvent) => void} emit
   * @param {AbortSignal | undefined} signal
   */
  async function callModel(messages, emit, signal) {
    for (let attempt = 0; ; attempt++) {
      const stream = client.beta.messages.stream(
        {
          model,
          max_tokens: 64000,
          system: SYSTEM_PROMPT,
          tools: toolkit.definitions,
          messages,
          thinking: { type: "adaptive" },
          output_config: { effort },
          // Caches the conversation so far; each turn re-reads it cheaply.
          cache_control: { type: "ephemeral" },
          betas: [FALLBACK_BETA],
          fallbacks: "default",
        },
        { signal },
      );
      stream.on("text", (text) => emit({ type: "text", text }));
      stream.on("streamEvent", (event) => {
        if (event.type !== "content_block_start") return;
        const block = event.content_block;
        if (block.type === "tool_use" || block.type === "server_tool_use") {
          const label = TOOL_STATUS[/** @type {keyof typeof TOOL_STATUS} */ (block.name)] ?? `Using ${block.name}`;
          emit({ type: "status", text: `${label}…` });
        }
      });
      try {
        return await stream.finalMessage();
      } catch (err) {
        // With eager input streaming, tool input JSON the SDK can't parse at
        // all rejects here. Re-issue that turn (nothing was appended yet);
        // API errors, aborts included, are rethrown.
        if (err instanceof Anthropic.APIError || attempt >= MAX_JSON_RETRIES) throw err;
        log(`[chat] unparseable tool input, retrying turn: ${/** @type {Error} */ (err).message}`);
      }
    }
  }

  /**
   * Runs one user message through the tool loop, streaming events to `emit`.
   * @param {{
   *   conversationId?: string,
   *   message: string,
   *   emit: (event: ChatEvent) => void,
   *   signal?: AbortSignal,
   * }} request
   */
  async function send({ conversationId, message, emit, signal }) {
    const text = message.trim();
    if (!text) throw new ChatError(400, "Message is empty.");
    if (text.length > 4000) throw new ChatError(400, "Message is too long (4,000 characters max).");

    prune();
    let id = conversationId && conversations.has(conversationId) ? conversationId : null;
    if (!id) {
      id = crypto.randomUUID();
      conversations.set(id, { messages: [], turns: 0, busy: false, updatedAt: now().getTime() });
    }
    const convo = /** @type {NonNullable<ReturnType<typeof conversations.get>>} */ (conversations.get(id));
    if (convo.busy) throw new ChatError(409, "Still answering your last message.");
    if (convo.turns >= maxTurns) {
      throw new ChatError(400, "This conversation is full. Start a new chat to keep going.");
    }
    checkRateLimit();

    convo.busy = true;
    convo.turns += 1;
    convo.updatedAt = now().getTime();
    emit({ type: "conversation", id });

    // Everything this exchange appends; rolled back if it can't finish cleanly.
    const checkpoint = convo.messages.length;
    const messages = convo.messages;
    const rollback = () => {
      messages.length = checkpoint;
      convo.turns -= 1;
    };

    messages.push({
      role: "user",
      content: [
        { type: "text", text: dateContext(now(), timeZone) },
        { type: "text", text },
      ],
    });

    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const response = await callModel(messages, emit, signal);
        const toolUses = /** @type {ToolUseBlock[]} */ (response.content.filter((b) => b.type === "tool_use"));

        switch (response.stop_reason) {
          case "refusal":
            // Declined even after fallback. Drop the exchange so it doesn't
            // poison later turns, and discard any partial text.
            rollback();
            emit({ type: "error", message: "Tide AI can't help with that one. Try asking another way." });
            return;

          case "pause_turn":
            // A long server-side web search paused; send it back to resume.
            messages.push({ role: "assistant", content: response.content });
            continue;

          case "max_tokens":
            if (toolUses.length > 0) {
              // A cut-off tool call may parse but be truncated: never run it.
              rollback();
              emit({ type: "error", message: "That answer ran too long. Try a narrower question." });
              return;
            }
            messages.push({ role: "assistant", content: response.content });
            emit({ type: "done", stopReason: "max_tokens" });
            return;

          case "tool_use": {
            messages.push({ role: "assistant", content: response.content });
            const results = await Promise.all(
              toolUses.map(async (use) => {
                const { content, isError } = await toolkit.run(use.name, use.input);
                return /** @type {ToolResultParam} */ ({
                  type: "tool_result",
                  tool_use_id: use.id,
                  content,
                  ...(isError ? { is_error: true } : {}),
                });
              }),
            );
            // All results go back together in a single user turn.
            messages.push({ role: "user", content: results });
            continue;
          }

          default:
            messages.push({ role: "assistant", content: response.content });
            emit({ type: "done", stopReason: response.stop_reason });
            return;
        }
      }
      emit({ type: "status", text: "Stopped after too many lookups. Ask a follow-up to keep going." });
      emit({ type: "done", stopReason: "max_steps" });
    } catch (err) {
      rollback();
      if (err instanceof Anthropic.APIUserAbortError || signal?.aborted) return;
      log(`[chat] ${describe(err)}`);
      emit({ type: "error", message: friendlyError(err) });
    } finally {
      convo.busy = false;
      convo.updatedAt = now().getTime();
    }
  }

  return { send, conversationCount: () => conversations.size };
}

/** @param {unknown} err */
function describe(err) {
  if (err instanceof Anthropic.APIError) return `${err.status ?? ""} ${err.message}`;
  return err instanceof Error ? err.stack ?? err.message : String(err);
}

/** @param {unknown} err */
export function friendlyError(err) {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return "Tide AI isn't set up yet: add a valid ANTHROPIC_API_KEY to .env and restart.";
  }
  if (err instanceof Anthropic.RateLimitError) return "Tide AI is busy right now. Give it a minute and try again.";
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach the AI service. Check the internet connection.";
  if (err instanceof Anthropic.InternalServerError) return "The AI service had a hiccup. Try again.";
  if (err instanceof Anthropic.APIError) return `The AI service returned an error (${err.status ?? "unknown"}).`;
  // The SDK throws a plain Error when it finds no credentials at all.
  return "Something went wrong answering that. If it keeps happening, check that ANTHROPIC_API_KEY is set in .env.";
}

/** @typedef {ReturnType<typeof createChatService>} ChatService */
