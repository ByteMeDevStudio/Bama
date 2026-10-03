import { getJson } from "../api.js";
import { html, mount } from "../html.js";
import { gameCard } from "../components.js";

const TABS = [
  { id: "top25", label: "Top 25" },
  { id: "sec", label: "SEC" },
  { id: "fbs", label: "All FBS" },
  { id: "nfl", label: "NFL" },
];

/** @param {import("../app.js").ViewContext} ctx */
export async function scoresView(ctx) {
  const tab = TABS.some((t) => t.id === ctx.query.get("tab")) ? /** @type {string} */ (ctx.query.get("tab")) : "top25";
  const date = /^\d{8}$/.test(ctx.query.get("date") ?? "") ? /** @type {string} */ (ctx.query.get("date")) : "";

  const params = new URLSearchParams();
  if (tab === "nfl") params.set("league", "nfl");
  else params.set("scope", tab);
  if (date) params.set("date", date);

  const load = async () => {
    const board = await getJson(`/api/scoreboard?${params}`);
    if (!ctx.isCurrent()) return null;
    const list = /** @type {HTMLElement | null} */ (ctx.view.querySelector("#board"));
    if (list) mount(list, renderBoard(board, tab));
    return board;
  };

  mount(
    ctx.view,
    html`
      <div class="page-head">
        <h1>Scores</h1>
        <div class="date-nav">
          <input type="date" id="date" value="${date ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}` : ""}" aria-label="Pick a date" />
          ${date ? html`<a class="btn" href="${link(tab, "")}">This week</a>` : ""}
        </div>
      </div>
      <nav class="tabs" aria-label="Scoreboards">
        ${TABS.map((t) => html`<a href="${link(t.id, date)}" class="${t.id === tab ? "active" : ""}">${t.label}</a>`)}
      </nav>
      <div id="board"></div>
    `,
  );
  ctx.view.querySelector("#date")?.addEventListener("change", (e) => {
    const value = /** @type {HTMLInputElement} */ (e.target).value.replaceAll("-", "");
    location.hash = link(tab, value);
  });

  const board = await load();
  if (board?.events.some((/** @type {any} */ e) => e.status.state === "in")) {
    const timer = setInterval(() => void load().catch(() => {}), 30_000);
    ctx.onCleanup(() => clearInterval(timer));
  }
}

/**
 * @param {string} tab
 * @param {string} date
 */
function link(tab, date) {
  const q = new URLSearchParams();
  if (tab !== "top25") q.set("tab", tab);
  if (date) q.set("date", date);
  const s = q.toString();
  return `#/scores${s ? `?${s}` : ""}`;
}

/**
 * @param {any} board
 * @param {string} tab
 */
function renderBoard(board, tab) {
  if (!board.events.length) {
    return html`<div class="card"><p class="muted">No games${board.week ? ` in week ${board.week}` : ""} for this view. Try another date.</p></div>`;
  }
  return html`
    <p class="muted small">${board.season ?? ""} ${board.week ? `· Week ${board.week}` : ""} · ${board.events.length} games</p>
    <div class="card-grid">
      ${board.events.map((/** @type {any} */ g) =>
        // Game Center covers college games; NFL cards open ESPN.
        tab === "nfl" ? gameCard(g, { href: `https://www.espn.com/nfl/game/_/gameId/${g.id}` }) : gameCard(g),
      )}
    </div>`;
}
