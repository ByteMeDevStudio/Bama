// Pieces of UI shared across views.

import { html, safeUrl } from "./html.js";
import { logo, teamName, statusLine, tvBadges, resultBadge, opponentOf, kickoff, venueLine } from "./format.js";

/** @param {string | null | undefined} color */
export function safeColor(color, fallback = "var(--muted)") {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

/** Away team over home team with scores: used on cards and scoreboards. */
export function scoreRows(game) {
  const post = game.status.state === "post";
  /** @param {any} t */
  const row = (t) => html`
    <div class="score-row ${post && t.winner ? "winner" : ""} ${post && t.winner === false ? "loser" : ""}">
      ${logo(t, 28)}
      <span class="team">${teamName(t, true)}${t.record ? html`<small class="record">${t.record}</small>` : ""}</span>
      ${t.possession && game.status.state === "in" ? html`<span class="poss" title="Has the ball">●</span>` : ""}
      <span class="score">${t.score ?? ""}</span>
    </div>`;
  return html`${row(game.away)}${row(game.home)}`;
}

/**
 * A compact game card for scoreboards.
 * @param {any} game
 * @param {{ href?: string }} [options]  defaults to the Game Center
 */
export function gameCard(game, { href } = {}) {
  const live = game.status.state === "in";
  const link = href ?? `#/game/${game.id}`;
  const external = link.startsWith("http");
  return html`
    <a class="card game-card ${live ? "is-live" : ""}" href="${link}" ${external ? html`target="_blank" rel="noopener noreferrer"` : ""}>
      <div class="game-card-top">
        <span class="status ${live ? "live" : ""}">${live ? html`<span class="dot"></span>` : ""}${statusLine(game)}</span>
        <span class="tv">${tvBadges(game.broadcasts)}</span>
      </div>
      ${scoreRows(game)}
      ${live && game.situation?.downDistance ? html`<div class="situation-mini">${game.situation.downDistance}${game.situation.isRedZone ? html` <span class="redzone">Red zone</span>` : ""}</div>` : ""}
      ${game.headline ? html`<div class="headline-note">${game.headline}</div>` : ""}
    </a>`;
}

/** One line in Alabama's schedule. */
export function scheduleRow(game) {
  const { opponent, prefix } = opponentOf(game);
  const live = game.status.state === "in";
  return html`
    <a class="sched-row ${live ? "is-live" : ""}" href="#/game/${game.id}">
      <div class="sched-date">
        <strong>${game.date ? new Date(game.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "TBD"}</strong>
        <small>${game.weekText ?? (game.seasonType === 3 ? "Postseason" : "")}</small>
      </div>
      <div class="sched-opp">
        ${logo(opponent, 34)}
        <div>
          <div class="opp-name"><span class="vs">${prefix}</span> ${teamName(opponent)}</div>
          <small class="muted">${game.headline ? html`${game.headline} · ` : ""}${venueLine(game)}</small>
        </div>
      </div>
      <div class="sched-status">
        ${game.result
          ? resultBadge(game.result)
          : live
            ? html`<span class="status live"><span class="dot"></span>${game.status.shortDetail} · ${game.away.abbreviation} ${game.away.score}–${game.home.score} ${game.home.abbreviation}</span>`
            : html`<span>${game.timeTbd || !game.date ? "Time TBA" : new Date(game.date).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>`}
        <span class="tv">${tvBadges(game.broadcasts)}</span>
      </div>
    </a>`;
}

/** Where-to-watch buttons for one game. */
export function watchButtons(options, limit = Infinity) {
  return html`<div class="watch-list">
    ${options.slice(0, limit).map((o) => {
      const url = safeUrl(o.url);
      const body = html`<span class="watch-label">${o.kind === "free" ? html`<span class="free-tag">FREE</span> ` : ""}${o.label}</span><small>${o.note}</small>`;
      return url
        ? html`<a class="watch-option ${o.kind}" href="${url}" target="_blank" rel="noopener noreferrer">${body}</a>`
        : html`<div class="watch-option ${o.kind}">${body}</div>`;
    })}
  </div>`;
}

/** Win-probability bar in team colors. */
export function winProbBar(game, prob, label) {
  if (!prob || prob.home === null || prob.away === null) return "";
  const away = Math.max(0, Math.min(100, prob.away));
  const home = Math.max(0, Math.min(100, prob.home));
  return html`
    <div class="winprob">
      <div class="winprob-labels">
        <span>${game.away.abbreviation} ${away.toFixed(1)}%</span>
        <small>${label}</small>
        <span>${home.toFixed(1)}% ${game.home.abbreviation}</span>
      </div>
      <div class="winprob-bar" role="img" aria-label="${`${label}: ${game.away.abbreviation} ${away.toFixed(1)}%, ${game.home.abbreviation} ${home.toFixed(1)}%`}">
        <span style="width:${away}%;background:${safeColor(game.away.color, "#828a8f")}"></span>
        <span style="width:${home}%;background:${safeColor(game.home.color, "#9e1b32")}"></span>
      </div>
    </div>`;
}

/** Kickoff, venue and TV for a game that hasn't started. */
export function gameMeta(game) {
  return html`<div class="game-meta">
    <span>${kickoff(game.date, game.timeTbd)}</span>
    ${venueLine(game) ? html`<span>${venueLine(game)}</span>` : ""}
    <span class="tv">${tvBadges(game.broadcasts)}</span>
  </div>`;
}

/** Big two-team header with scores. */
export function matchupHeader(game) {
  const live = game.status.state === "in";
  /** @param {any} t */
  const side = (t) => html`
    <div class="mh-team ${game.status.state === "post" && t.winner ? "winner" : ""}">
      ${logo(t, 64)}
      <div class="mh-name">${teamName(t, true)}</div>
      <small class="muted">${t.record ?? ""}</small>
    </div>`;
  const scores = game.status.state !== "pre";
  return html`
    <div class="matchup">
      ${side(game.away)}
      <div class="mh-center">
        ${scores ? html`<div class="mh-score"><span>${game.away.score ?? 0}</span><span class="dash">–</span><span>${game.home.score ?? 0}</span></div>` : html`<div class="mh-at">${game.neutralSite ? "vs" : "at"}</div>`}
        ${scores ? html`<div class="status ${live ? "live" : ""}">${live ? html`<span class="dot"></span>` : ""}${statusLine(game)}</div>` : ""}
      </div>
      ${side(game.home)}
    </div>`;
}
