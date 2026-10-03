import test from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import { ChatError, createChatService } from "../src/ai/chat.js";
import { SYSTEM_PROMPT } from "../src/ai/prompt.js";

/**
 * A stand-in for client.beta.messages.stream(). Each queued response is a
 * message object, an Error to throw from finalMessage(), or a function.
 * @param {any[]} responses
 */
function fakeClient(responses) {
  /** @type {any[]} */
  const calls = [];
  const client = {
    calls,
    beta: {
      messages: {
        /**
         * @param {any} params
         * @param {any} options
         */
        stream(params, options) {
          calls.push(structuredClone(params));
          const next = responses.shift();
          /** @type {Record<string, Function[]>} */
          const handlers = {};
          return {
            /**
             * @param {string} event
             * @param {Function} fn
             */
            on(event, fn) {
              (handlers[event] ??= []).push(fn);
              return this;
            },
            async finalMessage() {
              const msg = typeof next === "function" ? await next(params, options) : next;
              if (msg instanceof Error) throw msg;
              for (const block of msg.content) {
                if (block.type === "tool_use" || block.type === "server_tool_use") {
                  for (const fn of handlers.streamEvent ?? []) fn({ type: "content_block_start", index: 0, content_block: block });
                }
                if (block.type === "text") for (const fn of handlers.text ?? []) fn(block.text);
              }
              return msg;
            },
          };
        },
      },
    },
  };
  return client;
}

/**
 * @param {any[]} content
 * @param {string} stop_reason
 */
const message = (content, stop_reason) => ({ id: "msg", type: "message", role: "assistant", model: "m", content, stop_reason });
const thinking = { type: "thinking", thinking: "", signature: "sig-abc" };

function fakeToolkit() {
  /** @type {{ name: string, input: unknown }[]} */
  const ran = [];
  return {
    ran,
    definitions: [{ name: "get_alabama_schedule", description: "d", input_schema: { type: "object" } }],
    /**
     * @param {string} name
     * @param {unknown} input
     */
    async run(name, input) {
      ran.push({ name, input });
      return { content: JSON.stringify({ tool: name }), isError: name === "broken" };
    },
  };
}

/** @param {any} client */
function service(client, extra = {}) {
  const toolkit = fakeToolkit();
  const chat = createChatService({
    client,
    toolkit: /** @type {any} */ (toolkit),
    model: "claude-opus-5-5",
    effort: "medium",
    timeZone: "America/Chicago",
    maxTurns: 40,
    rateLimitPerHour: 100,
    now: () => new Date("2026-10-03T19:00:00Z"),
    log: () => {},
    ...extra,
  });
  return { chat, toolkit };
}

/**
 * @param {ReturnType<typeof createChatService>} chat
 * @param {string} text
 * @param {string} [conversationId]
 */
async function send(chat, text, conversationId, signal) {
  /** @type {any[]} */
  const events = [];
  await chat.send({ message: text, conversationId, emit: (e) => events.push(e), signal });
  return events;
}

test("runs tools, streams text, and keeps history append-only", async () => {
  const client = fakeClient([
    message([thinking, { type: "tool_use", id: "tu1", name: "get_alabama_schedule", input: {} }], "tool_use"),
    message([thinking, { type: "text", text: "Next up: Tennessee on ABC. Roll Tide!" }], "end_turn"),
    message([{ type: "text", text: "Kickoff is 2:30." }], "end_turn"),
  ]);
  const { chat, toolkit } = service(client);

  const events = await send(chat, "When's the next game?");
  const id = events[0].id;
  assert.equal(events[0].type, "conversation");
  assert.deepEqual(events.slice(1), [
    { type: "status", text: "Checking the schedule…" },
    { type: "text", text: "Next up: Tennessee on ABC. Roll Tide!" },
    { type: "done", stopReason: "end_turn" },
  ]);
  assert.deepEqual(toolkit.ran, [{ name: "get_alabama_schedule", input: {} }]);

  // Request shape.
  const first = client.calls[0];
  assert.equal(first.model, "claude-opus-5-5");
  assert.equal(first.system, SYSTEM_PROMPT);
  assert.deepEqual(first.thinking, { type: "adaptive" });
  assert.deepEqual(first.output_config, { effort: "medium" });
  assert.deepEqual(first.cache_control, { type: "ephemeral" });
  assert.equal(first.fallbacks, "default");
  assert.deepEqual(first.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(first.tool_choice, undefined, "forced tool choice is rejected on this model");
  assert.match(first.messages[0].content[0].text, /^Current date and time: Saturday, October 3, 2026/);
  assert.equal(first.messages[0].content[1].text, "When's the next game?");

  // The tool round trip: assistant turn replayed verbatim (thinking included),
  // then one user turn with the result.
  const second = client.calls[1];
  assert.equal(second.messages.length, 3);
  assert.deepEqual(second.messages[1].content[0], thinking);
  assert.deepEqual(second.messages[2].content, [{ type: "tool_result", tool_use_id: "tu1", content: '{"tool":"get_alabama_schedule"}' }]);

  // A follow-up extends the same history without editing it.
  const followUp = await send(chat, "What time?", id);
  assert.equal(followUp[0].id, id);
  const third = client.calls[2];
  assert.deepEqual(third.messages.slice(0, 4), [...second.messages, { role: "assistant", content: message([thinking, { type: "text", text: "Next up: Tennessee on ABC. Roll Tide!" }], "end_turn").content }]);
  assert.equal(third.messages.length, 5);
  assert.equal(JSON.stringify(third.tools), JSON.stringify(first.tools));
  assert.equal(third.system, first.system);
});

test("parallel tool calls come back in a single user turn", async () => {
  const client = fakeClient([
    message(
      [
        { type: "tool_use", id: "a", name: "get_alabama_schedule", input: {} },
        { type: "tool_use", id: "b", name: "broken", input: {} },
      ],
      "tool_use",
    ),
    message([{ type: "text", text: "ok" }], "end_turn"),
  ]);
  const { chat } = service(client);
  await send(chat, "two things");
  const results = client.calls[1].messages[2].content;
  assert.equal(results.length, 2);
  assert.equal(results[0].tool_use_id, "a");
  assert.equal(results[0].is_error, undefined);
  assert.equal(results[1].tool_use_id, "b");
  assert.equal(results[1].is_error, true);
});

test("pause_turn is resumed by sending the paused turn back", async () => {
  const paused = message([{ type: "server_tool_use", id: "s1", name: "web_search", input: { query: "bama injuries" } }], "pause_turn");
  const client = fakeClient([paused, message([{ type: "text", text: "Here's the latest." }], "end_turn")]);
  const { chat } = service(client);
  const events = await send(chat, "injury news?");
  assert.deepEqual(events.at(-1), { type: "done", stopReason: "end_turn" });
  assert.equal(client.calls[1].messages.length, 2);
  assert.deepEqual(client.calls[1].messages[1], { role: "assistant", content: paused.content });
  assert.ok(events.some((e) => e.type === "status" && e.text === "Searching the web…"));
});

test("a refusal rolls the exchange back", async () => {
  const client = fakeClient([
    message([{ type: "text", text: "partial" }], "refusal"),
    message([{ type: "text", text: "fine" }], "end_turn"),
  ]);
  const { chat } = service(client);
  const events = await send(chat, "something off-limits");
  assert.equal(events.at(-1).type, "error");
  const id = events[0].id;
  await send(chat, "normal question", id);
  assert.equal(client.calls[1].messages.length, 1, "the refused turn is gone");
  assert.equal(client.calls[1].messages[0].content[1].text, "normal question");
});

test("a tool call cut off by max_tokens is never run", async () => {
  const client = fakeClient([message([{ type: "tool_use", id: "t", name: "get_alabama_schedule", input: {} }], "max_tokens")]);
  const { chat, toolkit } = service(client);
  const events = await send(chat, "huge");
  assert.equal(toolkit.ran.length, 0);
  assert.equal(events.at(-1).type, "error");
});

test("unparseable tool JSON is retried; API errors are not", async () => {
  const client = fakeClient([new SyntaxError("Unexpected token"), message([{ type: "text", text: "ok" }], "end_turn")]);
  const { chat } = service(client);
  const events = await send(chat, "hi");
  assert.deepEqual(events.at(-1), { type: "done", stopReason: "end_turn" });
  assert.equal(client.calls.length, 2);

  const rateLimited = Anthropic.APIError.generate(429, { type: "error", error: { type: "rate_limit_error", message: "slow down" } }, "slow down", new Headers());
  const client2 = fakeClient([rateLimited]);
  const { chat: chat2 } = service(client2);
  const events2 = await send(chat2, "hi");
  assert.equal(client2.calls.length, 1);
  assert.deepEqual(events2.at(-1), { type: "error", message: "Tide AI is busy right now. Give it a minute and try again." });
});

test("bad credentials get a setup hint", async () => {
  const unauthorized = Anthropic.APIError.generate(401, { type: "error", error: { type: "authentication_error", message: "bad key" } }, "bad key", new Headers());
  const { chat } = service(fakeClient([unauthorized]));
  const events = await send(chat, "hi");
  assert.match(events.at(-1).message, /ANTHROPIC_API_KEY/);
});

test("one message at a time per conversation", async () => {
  /** @type {(v: any) => void} */
  let release = () => {};
  const gate = new Promise((resolve) => (release = resolve));
  const client = fakeClient([async () => gate, message([{ type: "text", text: "second" }], "end_turn")]);
  const { chat } = service(client);

  /** @type {any[]} */
  const events = [];
  const first = chat.send({ message: "first", emit: (e) => events.push(e) });
  await new Promise((r) => setImmediate(r));
  const id = events[0].id;
  await assert.rejects(chat.send({ message: "again", conversationId: id, emit: () => {} }), (err) => err instanceof ChatError && err.status === 409);
  release(message([{ type: "text", text: "first done" }], "end_turn"));
  await first;
  const second = await send(chat, "now", id);
  assert.deepEqual(second.at(-1), { type: "done", stopReason: "end_turn" });
});

test("input limits and the hourly rate limit", async () => {
  const { chat } = service(fakeClient([message([{ type: "text", text: "ok" }], "end_turn")]), { rateLimitPerHour: 1 });
  await assert.rejects(send(chat, "   "), (err) => err instanceof ChatError && err.status === 400);
  await assert.rejects(send(chat, "x".repeat(4001)), (err) => err instanceof ChatError && err.status === 400);
  await send(chat, "one");
  await assert.rejects(send(chat, "two"), (err) => err instanceof ChatError && err.status === 429);
});

test("an aborted request ends quietly and leaves no half-finished turn", async () => {
  const controller = new AbortController();
  const abortError = new Anthropic.APIUserAbortError();
  const client = fakeClient([
    async () => {
      controller.abort();
      return abortError;
    },
    message([{ type: "text", text: "ok" }], "end_turn"),
  ]);
  const { chat } = service(client);
  const events = await send(chat, "hi", undefined, controller.signal);
  assert.deepEqual(
    events.map((e) => e.type),
    ["conversation"],
  );
  await send(chat, "again", events[0].id);
  assert.equal(client.calls[1].messages.length, 1);
});
