// Game Center: live score, situation, win probability, team and player stats,
// scoring summary and drives. Refreshes itself while the game is on.

import { getJson } from "../api.js";
import { html, mount } from "../html.js";
import { gameMeta, matchupHeader, safeColor, watchButtons, winProbBar } from "../components.js";

/** @param {import("../app.js").ViewContext} ctx */
export async function gameView(ctx) {
  const id = ctx.params[0];
  /** @type {Set<string>} */
  const openSections = new Set();

  const load = async () => {
    const game = await getJson(`/api/games/${id}`);
    if (!ctx.isCurrent()) return null;
    // Remember which collapsible sections were open across refreshes.
    for (const d of ctx.view.querySelectorAll("details[data-key]")) {
      const key = d.getAttribute("data-key") ?? "";
      if (/** @type {HTMLDetailsElement} */ (d).open) openSections.add(key);
      else openSections.delete(key);
    }
    mount(ctx.view, render(game, openSections));
    return game;
  };

  const game = await load();
  if (!game) return;

  const live = game.status.state === "in";
  const soon = game.status.state === "pre" && Date.parse(game.date) - Date.now() < 30 * 60_000;
  if (live || soon) {
    const timer = setInterval(async () => {
      try {
        const g = await load();
        if (g?.status.state === "post") clearInterval(timer);
      } catch {
        // try again next tick
      }
    }, live ? 15_000 : 60_000);
    ctx.onCleanup(() => clearInterval(timer));
  }
}

/**
 * @param {any} g
 * @param {Set<string>} open
 */
function render(g, open) {
  const state = g.status.state;
  return html`
    <p class="crumbs"><a href="#/schedule">← Schedule</a></p>
    <section class="card game-head ${state === "in" ? "is-live" : ""}">
      ${g.headline ? html`<div class="eyebrow">${g.headline}</div>` : ""}
      ${matchupHeader(g)}
      ${linescore(g)}
      ${state === "in" && g.situation
        ? html`<div class="situation">
            ${g.situation.downDistance ? html`<strong>${g.situation.downDistance}</strong>` : ""}
            ${g.situation.isRedZone ? html`<span class="redzone">Red zone</span>` : ""}
            ${g.situation.lastPlay ? html`<p><small class="muted">Last play</small> ${g.situation.lastPlay}</p>` : ""}
          </div>`
        : ""}
      ${state === "pre"
        ? winProbBar(g, g.predictor, `${g.predictor?.source ?? "ESPN FPI"} pregame`)
        : winProbBar(g, g.winProbability, state === "in" ? "Live win probability" : "Final win probability")}
      ${gameMeta(g)}
      ${g.odds?.details ? html`<p class="muted small">Line: ${g.odds.details}${g.odds.overUnder ? ` · O/U ${g.odds.overUnder}` : ""}</p>` : ""}
      ${g.info?.attendance ? html`<p class="muted small">Attendance ${Number(g.info.attendance).toLocaleString()}${g.info.weather ? ` · ${g.info.weather}` : ""}</p>` : ""}
      <div class="actions">
        <a class="btn" href="#/radio">Listen live</a>
        <a class="btn" href="${g.links.espn}" target="_blank" rel="noopener noreferrer">ESPN game page</a>
      </div>
    </section>

    ${state === "pre" ? html`<section class="card"><h2>Where to watch</h2>${watchButtons(g.watch)}</section>` : ""}

    ${g.teamStats.length || g.leaders.length
      ? html`<div class="grid two">
          ${g.teamStats.length ? teamStats(g) : ""}
          ${g.leaders.length ? leaders(g) : ""}
        </div>`
      : state === "pre"
        ? ""
        : html`<section class="card"><p class="muted">Stats will appear here once the game starts.</p></section>`}

    ${g.scoringPlays.length ? scoring(g) : ""}
    ${g.drives.length ? section("drives", `Drives (${g.drives.length})`, drives(g), open) : ""}
    ${g.players.away.length || g.players.home.length ? section("box", "Box score", boxScore(g), open) : ""}
  `;
}

/**
 * @param {string} key
 * @param {string} title
 * @param {unknown} body
 * @param {Set<string>} open
 */
function section(key, title, body, open) {
  return html`<details class="card collapsible" data-key="${key}" ${open.has(key) ? html`open` : ""}>
    <summary><h2>${title}</h2></summary>
    ${body}
  </details>`;
}

/** @param {any} g */
function linescore(g) {
  const periods = Math.max(g.away.linescores.length, g.home.linescores.length);
  if (!periods) return "";
  const labels = Array.from({ length: periods }, (_, i) => (i < 4 ? String(i + 1) : i === 4 ? "OT" : `${i - 3}OT`));
  /** @param {any} t */
  const row = (t) => html`<tr>
    <th scope="row">${t.abbreviation}</th>
    ${labels.map((_, i) => html`<td>${t.linescores[i] ?? ""}</td>`)}
    <td class="total">${t.score ?? ""}</td>
  </tr>`;
  return html`<div class="table-wrap"><table class="linescore">
    <thead><tr><th></th>${labels.map((l) => html`<th>${l}</th>`)}<th>T</th></tr></thead>
    <tbody>${row(g.away)}${row(g.home)}</tbody>
  </table></div>`;
}

/** @param {any} g */
function teamStats(g) {
  return html`<section class="card">
    <h2>Team stats</h2>
    <table class="compare">
      <thead><tr><th>${g.away.abbreviation}</th><th></th><th>${g.home.abbreviation}</th></tr></thead>
      <tbody>
        ${g.teamStats.map(
          (/** @type {any} */ s) => html`<tr><td>${s.away}</td><th scope="row">${s.label}</th><td>${s.home}</td></tr>`,
        )}
      </tbody>
    </table>
  </section>`;
}

/** @param {any} g */
function leaders(g) {
  /** @param {any} p */
  const cell = (p) => (p ? html`<strong>${p.name}</strong><small>${p.value}</small>` : html`<span class="muted">–</span>`);
  return html`<section class="card">
    <h2>Leaders</h2>
    <div class="leaders">
      ${g.leaders.map(
        (/** @type {any} */ l) => html`<div class="leader-row">
          <div class="leader">${cell(l.away)}</div>
          <div class="leader-cat">${l.category}</div>
          <div class="leader right">${cell(l.home)}</div>
        </div>`,
      )}
    </div>
  </section>`;
}

/** @param {any} g */
function scoring(g) {
  return html`<section class="card">
    <h2>Scoring summary</h2>
    <ol class="plays">
      ${g.scoringPlays.map(
        (/** @type {any} */ p) => html`<li>
          <span class="play-team" style="border-color:${safeColor(p.side === "home" ? g.home.color : g.away.color)}">${p.team}</span>
          <div>
            <small class="muted">Q${p.period ?? "?"} ${p.clock ?? ""} · ${p.type}</small>
            <p>${p.text}</p>
          </div>
          <span class="play-score">${p.awayScore}–${p.homeScore}</span>
        </li>`,
      )}
    </ol>
  </section>`;
}

/** @param {any} g */
function drives(g) {
  return html`<div class="table-wrap"><table class="drives">
    <thead><tr><th>Team</th><th>Qtr</th><th>Start</th><th>Plays-Yds</th><th>Time</th><th>Result</th></tr></thead>
    <tbody>
      ${g.drives.map(
        (/** @type {any} */ d) => html`<tr class="${d.isScore ? "scored" : ""}">
          <td>${d.team}</td><td>${d.quarter ?? ""}</td><td>${d.start ?? ""}</td>
          <td>${d.plays ?? "–"}-${d.yards ?? "–"}</td><td>${d.time ?? ""}</td><td>${d.result}</td>
        </tr>`,
      )}
    </tbody>
  </table></div>`;
}

/** @param {any} g */
function boxScore(g) {
  /** @param {any} team @param {any[]} cats */
  const teamBox = (team, cats) => html`<div>
    <h3>${team.name}</h3>
    ${cats
      .filter((c) => c.athletes.length)
      .map(
        (c) => html`<div class="table-wrap"><table class="box">
          <caption>${c.title}</caption>
          <thead><tr><th></th>${c.labels.map((/** @type {string} */ l) => html`<th>${l}</th>`)}</tr></thead>
          <tbody>
            ${c.athletes.map(
              (/** @type {any} */ a) => html`<tr><th scope="row">${a.name}</th>${a.stats.map((/** @type {string} */ s) => html`<td>${s}</td>`)}</tr>`,
            )}
          </tbody>
        </table></div>`,
      )}
  </div>`;
  return html`<div class="grid two">${teamBox(g.away, g.players.away)}${teamBox(g.home, g.players.home)}</div>`;
}
