// Display helpers shared by the views.

import { html, safeUrl } from "./html.js";

export const ALABAMA_ID = "333";

/** @param {string | null} iso */
export function kickoff(iso, timeTbd = false) {
  if (!iso) return "TBD";
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  if (timeTbd) return `${day} · Time TBA`;
  return `${day} · ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

/** @param {string | null} iso */
export function shortDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** @param {string | null} iso */
export function timeAgo(iso) {
  if (!iso) return "";
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return shortDate(iso);
}

/** @param {number} ms */
export function countdown(ms) {
  if (ms <= 0) return "Kickoff!";
  const s = Math.floor(ms / 1000);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  return `${hours}h ${String(mins).padStart(2, "0")}m ${String(secs).padStart(2, "0")}s`;
}

/** @param {any} team */
export function teamName(team, short = false) {
  return html`${team.rank ? html`<span class="rank">${team.rank}</span> ` : ""}${short ? team.shortName : team.name}`;
}

/** @param {any} team */
export function logo(team, size = 32) {
  const src = safeUrl(team.logo);
  return src
    ? html`<img class="logo" src="${src}" alt="" width="${size}" height="${size}" loading="lazy" />`
    : html`<span class="logo logo-blank" style="width:${size}px;height:${size}px"></span>`;
}

/** The opponent and "vs"/"at" from Alabama's point of view. */
export function opponentOf(game) {
  const us = game.alabama;
  if (!us) return { opponent: game.away, prefix: "" };
  const opponent = us === "home" ? game.away : game.home;
  const prefix = game.neutralSite ? "vs" : us === "home" ? "vs" : "at";
  return { opponent, prefix };
}

/** @param {any} game */
export function statusLine(game) {
  const s = game.status;
  if (s.state === "pre") return kickoff(game.date, game.timeTbd);
  return s.shortDetail || s.detail;
}

/** @param {string[]} broadcasts */
export function tvBadges(broadcasts) {
  if (!broadcasts?.length) return html`<span class="badge badge-muted">TV TBD</span>`;
  return broadcasts.map((b) => html`<span class="badge">${b}</span>`);
}

/** @param {{ outcome: string, score: string } | null} result */
export function resultBadge(result) {
  if (!result) return "";
  const cls = result.outcome === "W" ? "win" : result.outcome === "L" ? "loss" : "tie";
  return html`<span class="result ${cls}">${result.outcome} ${result.score}</span>`;
}

/** @param {unknown} err */
export function errorCard(err) {
  const message = err instanceof Error ? err.message : String(err);
  return html`<div class="card error-card"><strong>Couldn't load this.</strong><p>${message}</p></div>`;
}

export function loadingCard(text = "Loading…") {
  return html`<div class="card loading" aria-busy="true"><span class="spinner"></span>${text}</div>`;
}

/** @param {any} game */
export function venueLine(game) {
  return [game.venue?.name, [game.venue?.city, game.venue?.state].filter(Boolean).join(", ")]
    .filter(Boolean)
    .join(" · ");
}

/**
 * localStorage that never throws (private windows, blocked storage).
 */
export const store = {
  /** @param {string} key */
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  /**
   * @param {string} key
   * @param {string} value
   */
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // ignore
    }
  },
};
