// Tide AI chat. The conversation lives in this module, so it survives moving
// between pages (the server keeps the model-side history).

import { getConfig, streamChat } from "../api.js";
import { html, mount, raw } from "../html.js";
import { renderMarkdown } from "../markdown.js";

const SUGGESTIONS = [
  "When's the next game, and what channel is it on?",
  "Break down Alabama's last game: key stats and who played well.",
  "What's Alabama's all-time record against Auburn?",
  "Who are Alabama's Heisman Trophy winners?",
  "How does Alabama's offense stack up in the SEC this season?",
];

/**
 * @typedef {{ role: "user" | "assistant", text: string, status: string | null, error: string | null, pending: boolean }} ChatMessage
 */

const session = {
  /** @type {string | null} */
  conversationId: null,
  /** @type {ChatMessage[]} */
  messages: [],
  busy: false,
  /** @type {(() => void) | null} */
  rerender: null,
};

/** @param {import("../app.js").ViewContext} ctx */
export async function aiView(ctx) {
  const config = await getConfig();
  if (!ctx.isCurrent()) return;

  mount(
    ctx.view,
    html`
      <div class="chat">
        <div class="page-head">
          <div>
            <h1>Tide AI</h1>
            <p class="muted">Ask about this season, live games, stats, history, or anything football.</p>
          </div>
          <button type="button" class="btn" id="new-chat">New chat</button>
        </div>
        ${config.ai.credentials
          ? ""
          : html`<div class="card notice">Tide AI needs an Anthropic API key. Add <code>ANTHROPIC_API_KEY</code> to the .env file and restart Bama Hub.</div>`}
        ${config.cfbd.configured
          ? ""
          : html`<div class="card notice">Tip: add a free <code>CFBD_API_KEY</code> (collegefootballdata.com/key) so Tide AI can look up history and season stats.</div>`}
        <div class="chat-log" id="log" aria-live="polite"></div>
        <form class="composer" id="composer">
          <label class="sr-only" for="prompt">Message Tide AI</label>
          <textarea id="prompt" rows="2" maxlength="4000" placeholder="Ask Tide AI…"></textarea>
          <button type="submit" class="btn primary" id="send">Send</button>
        </form>
        <p class="muted small">Answers use live ESPN data, CollegeFootballData.com${config.ai.webSearch ? " and web search" : ""}. Double-check anything important.</p>
      </div>
    `,
  );

  const log = /** @type {HTMLElement} */ (ctx.view.querySelector("#log"));
  const form = /** @type {HTMLFormElement} */ (ctx.view.querySelector("#composer"));
  const prompt = /** @type {HTMLTextAreaElement} */ (ctx.view.querySelector("#prompt"));
  const send = /** @type {HTMLButtonElement} */ (ctx.view.querySelector("#send"));

  let frame = 0;
  const render = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 120;
      mount(log, session.messages.length ? html`${session.messages.map(bubble)}` : emptyState());
      send.disabled = session.busy;
      if (nearBottom || session.busy) log.scrollTop = log.scrollHeight;
    });
  };
  session.rerender = render;
  ctx.onCleanup(() => {
    session.rerender = null;
    cancelAnimationFrame(frame);
  });
  render();

  /** @param {string} text */
  const ask = async (text) => {
    const message = text.trim();
    if (!message || session.busy) return;
    session.busy = true;
    session.messages.push({ role: "user", text: message, status: null, error: null, pending: false });
    /** @type {ChatMessage} */
    const reply = { role: "assistant", text: "", status: "Thinking…", error: null, pending: true };
    session.messages.push(reply);
    session.rerender?.();
    try {
      await streamChat({ message, conversationId: session.conversationId }, (event) => {
        if (event.type === "conversation") session.conversationId = event.id;
        else if (event.type === "text") {
          reply.text += event.text;
          reply.status = null;
        } else if (event.type === "status") reply.status = event.text;
        else if (event.type === "error") reply.error = event.message;
        session.rerender?.();
      });
    } catch (err) {
      reply.error = err instanceof Error ? err.message : "Something went wrong.";
    }
    reply.pending = false;
    reply.status = null;
    if (!reply.text && !reply.error) reply.error = "No answer came back. Try again.";
    session.busy = false;
    session.rerender?.();
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = prompt.value;
    prompt.value = "";
    void ask(text);
  });
  prompt.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  log.addEventListener("click", (e) => {
    const chip = /** @type {HTMLElement} */ (e.target).closest("[data-suggest]");
    if (chip) void ask(chip.getAttribute("data-suggest") ?? "");
  });
  ctx.view.querySelector("#new-chat")?.addEventListener("click", () => {
    if (session.busy) return;
    session.conversationId = null;
    session.messages = [];
    render();
    prompt.focus();
  });
  prompt.focus();
}

function emptyState() {
  return html`<div class="chat-empty">
    <p><strong>Roll Tide!</strong> I can pull live scores and box scores, this season's schedule and stats, polls, and Alabama's whole history. Try one of these:</p>
    <div class="chips">${SUGGESTIONS.map((s) => html`<button type="button" class="chip" data-suggest="${s}">${s}</button>`)}</div>
  </div>`;
}

/** @param {ChatMessage} m */
function bubble(m) {
  if (m.role === "user") return html`<div class="msg user"><p>${m.text}</p></div>`;
  return html`<div class="msg assistant ${m.pending ? "pending" : ""}">
    ${m.text ? html`<div class="md">${raw(renderMarkdown(m.text))}</div>` : ""}
    ${m.status ? html`<div class="msg-status"><span class="spinner small"></span>${m.status}</div>` : ""}
    ${m.error ? html`<div class="msg-error">${m.error}</div>` : ""}
  </div>`;
}
