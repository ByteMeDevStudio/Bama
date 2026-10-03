// CollegeFootballData.com: historical games, records, team and player stats,
// rankings, recruiting and more, back to the 1800s. Free API key from
// https://collegefootballdata.com/key. Only the endpoints and query parameters
// listed here can be requested, so the AI tool can't be pointed anywhere else.

import { TtlCache } from "../lib/cache.js";
import { fetchJson, UpstreamError } from "../lib/http.js";

/** Endpoint -> allowed query parameters, plus a description for the AI tool. */
export const CFBD_ENDPOINTS = {
  "/games": {
    params: ["year", "week", "seasonType", "team", "home", "away", "conference", "id"],
    about: "Game results and schedules. Needs year (or id).",
  },
  "/games/teams": {
    params: ["year", "week", "seasonType", "team", "conference", "gameId"],
    about: "Team box-score stats per game. Needs year plus week, team or conference (or gameId).",
  },
  "/games/players": {
    params: ["year", "week", "seasonType", "team", "conference", "category", "gameId"],
    about: "Player box-score stats per game. Same filters as /games/teams.",
  },
  "/records": { params: ["year", "team", "conference"], about: "Win-loss records by season." },
  "/teams/matchup": {
    params: ["team1", "team2", "minYear", "maxYear"],
    about: "All-time head-to-head series and every game between two teams.",
  },
  "/rankings": { params: ["year", "seasonType", "week"], about: "Historical AP, Coaches and CFP polls." },
  "/stats/season": {
    params: ["year", "team", "conference", "startWeek", "endWeek"],
    about: "Season team stats totals.",
  },
  "/stats/season/advanced": {
    params: ["year", "team", "excludeGarbageTime", "startWeek", "endWeek"],
    about: "Advanced team stats (EPA/PPA, success rate, explosiveness, havoc).",
  },
  "/stats/player/season": {
    params: ["year", "team", "conference", "startWeek", "endWeek", "seasonType", "category"],
    about: "Season player stats. category: passing, rushing, receiving, defensive, kicking, punting, interceptions, fumbles, kickReturns, puntReturns.",
  },
  "/ratings/sp": { params: ["year", "team"], about: "SP+ ratings." },
  "/ratings/elo": { params: ["year", "week", "seasonType", "team", "conference"], about: "Elo ratings." },
  "/roster": { params: ["team", "year"], about: "Team roster." },
  "/coaches": {
    params: ["firstName", "lastName", "team", "year", "minYear", "maxYear"],
    about: "Head coaches with season-by-season records.",
  },
  "/player/search": { params: ["searchTerm", "position", "team", "year"], about: "Find a player by name." },
  "/recruiting/players": {
    params: ["year", "team", "position", "state", "classification"],
    about: "Recruits and their ratings.",
  },
  "/recruiting/teams": { params: ["year", "team"], about: "Team recruiting class rankings." },
  "/talent": { params: ["year"], about: "247 team talent composite." },
  "/draft/picks": { params: ["year", "team", "school", "conference", "position"], about: "NFL draft picks; school = college." },
  "/lines": {
    params: ["gameId", "year", "week", "seasonType", "team", "home", "away", "conference"],
    about: "Betting lines.",
  },
  "/venues": { params: [], about: "Stadiums." },
  "/calendar": { params: ["year"], about: "Season week calendar." },
};

/** @typedef {keyof typeof CFBD_ENDPOINTS} CfbdEndpoint */

/**
 * Builds a query string from only the parameters the endpoint allows.
 * @param {CfbdEndpoint} endpoint
 * @param {Record<string, string | number | boolean | undefined | null>} params
 */
export function buildCfbdQuery(endpoint, params) {
  const spec = CFBD_ENDPOINTS[endpoint];
  if (!spec) throw new RangeError(`Unsupported endpoint ${endpoint}`);
  const allowed = new Set(spec.params);
  const qs = new URLSearchParams();
  const rejected = [];
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    if (!allowed.has(key)) {
      rejected.push(key);
      continue;
    }
    qs.set(key, String(value));
  }
  if (rejected.length > 0) {
    throw new RangeError(`${endpoint} does not accept: ${rejected.join(", ")}. Allowed: ${spec.params.join(", ") || "none"}`);
  }
  return qs.toString();
}

/**
 * @param {{ fetchImpl?: typeof fetch, cache?: TtlCache, apiKey: string, baseUrl: string }} options
 */
export function createCfbdClient({ fetchImpl = fetch, cache = new TtlCache(), apiKey, baseUrl }) {
  return {
    configured: Boolean(apiKey),

    /**
     * @param {CfbdEndpoint} endpoint
     * @param {Record<string, string | number | boolean | undefined | null>} [params]
     */
    async query(endpoint, params = {}) {
      if (!apiKey) {
        throw new UpstreamError(
          "CollegeFootballData",
          "no API key configured (set CFBD_API_KEY; free at collegefootballdata.com/key)",
        );
      }
      const qs = buildCfbdQuery(endpoint, params);
      const url = `${baseUrl}${endpoint}${qs ? `?${qs}` : ""}`;
      // The free tier has a monthly call budget, so cache generously.
      return cache.get(`cfbd:${url}`, 30 * 60_000, () =>
        fetchJson(fetchImpl, "CollegeFootballData", url, {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeoutMs: 15_000,
        }),
      );
    },
  };
}

/** @typedef {ReturnType<typeof createCfbdClient>} CfbdClient */
