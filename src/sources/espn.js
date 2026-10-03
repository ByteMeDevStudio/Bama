// ESPN's public site API (the JSON behind espn.com scoreboards). No key is
// needed, but it is unofficial and undocumented, so every field is read
// defensively and the shapes are normalized into something stable for the UI
// and the AI tools.

import { TtlCache } from "../lib/cache.js";
import { fetchJson } from "../lib/http.js";
import { watchOptions } from "../watch.js";

const BASE = "https://site.api.espn.com/apis/site/v2/sports/football";
export const ESPN_GAME_URL = "https://www.espn.com/college-football/game/_/gameId/";

/** @typedef {import("../watch.js").WatchOption} WatchOption */
/** @typedef {keyof typeof import("../watch.js").PROVIDER_LINKS} Provider */
/** @typedef {{ teamId: string, provider: Provider }} NormalizeOptions */

/**
 * @typedef {{
 *   id: string, name: string, shortName: string, abbreviation: string,
 *   logo: string | null, color: string | null, score: number | null,
 *   rank: number | null, record: string | null, winner: boolean | null,
 *   linescores: number[], possession: boolean,
 * }} TeamSide
 */

/** @param {any} c */
export function normalizeCompetitor(c = {}) {
  const team = c.team ?? {};
  const rawScore = c.score !== null && typeof c.score === "object" ? (c.score.value ?? c.score.displayValue) : c.score;
  const score = rawScore === undefined || rawScore === null || rawScore === "" ? NaN : Number(rawScore);
  const rawRank = Number(c.curatedRank?.current ?? c.rank);
  const records = c.records ?? c.record ?? [];
  const total = records.find((/** @type {any} */ r) => r.type === "total") ?? records[0];
  const name =
    team.displayName ?? ([team.location, team.name].filter(Boolean).join(" ") || "TBD");

  /** @type {TeamSide} */
  const side = {
    id: String(team.id ?? c.id ?? ""),
    name,
    shortName: team.shortDisplayName ?? team.location ?? name,
    abbreviation: team.abbreviation ?? "",
    logo: team.logo ?? team.logos?.[0]?.href ?? null,
    color: team.color ? `#${team.color}` : null,
    score: Number.isFinite(score) ? score : null,
    // ESPN uses 99 for "unranked".
    rank: rawRank >= 1 && rawRank <= 25 ? rawRank : null,
    record: total?.summary ?? total?.displayValue ?? null,
    winner: typeof c.winner === "boolean" ? c.winner : null,
    linescores: (c.linescores ?? [])
      .map((/** @type {any} */ l) => Number(l.value ?? l.displayValue))
      .filter(Number.isFinite),
    possession: c.possession === true,
  };
  return side;
}

/** @param {any} s */
export function normalizeStatus(s = {}) {
  const t = s.type ?? {};
  return {
    state: /** @type {"pre" | "in" | "post"} */ (t.state ?? "pre"),
    completed: Boolean(t.completed),
    name: t.name ?? "",
    detail: t.detail ?? t.description ?? "",
    shortDetail: t.shortDetail ?? t.detail ?? "",
    clock: s.displayClock ?? null,
    period: Number(s.period ?? 0),
  };
}

/** @param {any} comp */
export function broadcastNames(comp = {}) {
  /** @type {Set<string>} */
  const names = new Set();
  for (const b of comp.broadcasts ?? []) {
    if (b.type?.shortName === "Radio") continue;
    for (const n of b.names ?? []) names.add(n);
    const short = b.media?.shortName ?? b.media?.name;
    if (short) names.add(short);
  }
  if (names.size === 0) {
    for (const g of comp.geoBroadcasts ?? []) {
      if (g.type?.shortName === "Radio") continue;
      if (g.media?.shortName) names.add(g.media.shortName);
    }
  }
  return [...names];
}

/** @param {any} s */
function normalizeSituation(s) {
  if (!s) return null;
  return {
    downDistance: s.downDistanceText ?? s.shortDownDistanceText ?? null,
    possessionTeamId: s.possession ? String(s.possession) : null,
    isRedZone: Boolean(s.isRedZone),
    lastPlay: s.lastPlay?.text ?? null,
    homeTimeouts: s.homeTimeouts ?? null,
    awayTimeouts: s.awayTimeouts ?? null,
  };
}

/**
 * One game from a schedule, scoreboard, or summary header.
 * @param {any} event
 * @param {NormalizeOptions} options
 */
export function normalizeEvent(event, { teamId, provider }) {
  const comp = event.competitions?.[0] ?? {};
  const status = normalizeStatus(comp.status ?? event.status);
  const raw = comp.competitors ?? [];
  const home = normalizeCompetitor(raw.find((/** @type {any} */ c) => c.homeAway === "home") ?? raw[0]);
  const away = normalizeCompetitor(raw.find((/** @type {any} */ c) => c.homeAway === "away") ?? raw[1]);
  if (status.state === "pre") {
    home.score = null;
    away.score = null;
  }

  const alabama = home.id === teamId ? "home" : away.id === teamId ? "away" : null;
  /** @type {{ outcome: "W" | "L" | "T", score: string } | null} */
  let result = null;
  if (alabama && status.state === "post" && home.score !== null && away.score !== null) {
    const us = alabama === "home" ? home.score : away.score;
    const them = alabama === "home" ? away.score : home.score;
    result = {
      outcome: us > them ? "W" : us < them ? "L" : "T",
      score: `${us}-${them}`,
    };
  }

  const id = String(event.id ?? comp.id ?? "");
  const broadcasts = broadcastNames(comp);
  const odds = comp.odds?.[0];
  return {
    id,
    date: event.date ?? comp.date ?? null,
    timeTbd: event.timeValid === false || comp.timeValid === false,
    name: event.name ?? `${away.name} at ${home.name}`,
    shortName: event.shortName ?? `${away.abbreviation} @ ${home.abbreviation}`,
    week: event.week?.number ?? null,
    weekText: event.week?.text ?? null,
    seasonType: Number(event.seasonType?.type ?? event.season?.type ?? 0) || null,
    headline: comp.notes?.[0]?.headline ?? null,
    status,
    home,
    away,
    alabama,
    result,
    broadcasts,
    watch: watchOptions({ id, broadcasts }, provider),
    venue: {
      name: comp.venue?.fullName ?? null,
      city: comp.venue?.address?.city ?? null,
      state: comp.venue?.address?.state ?? null,
    },
    neutralSite: Boolean(comp.neutralSite),
    conferenceGame: Boolean(comp.conferenceCompetition),
    situation: status.state === "in" ? normalizeSituation(comp.situation) : null,
    odds: odds ? { details: odds.details ?? null, overUnder: odds.overUnder ?? null } : null,
    links: { espn: ESPN_GAME_URL + encodeURIComponent(id) },
  };
}

/** @typedef {ReturnType<typeof normalizeEvent>} Game */

/**
 * @param {any} regular  /teams/{id}/schedule?seasontype=2
 * @param {any} post     /teams/{id}/schedule?seasontype=3 (bowls / playoff), may be null
 * @param {NormalizeOptions & { season: number }} options
 */
export function normalizeSchedule(regular, post, options) {
  const team = regular?.team ?? post?.team ?? {};
  /** @type {Map<string, Game>} */
  const games = new Map();
  for (const source of [regular, post]) {
    for (const event of source?.events ?? []) {
      const game = normalizeEvent(event, options);
      games.set(game.id, game);
    }
  }
  const sorted = [...games.values()].sort((a, b) => Date.parse(a.date ?? "") - Date.parse(b.date ?? ""));
  return {
    season: options.season,
    team: {
      id: String(team.id ?? options.teamId),
      name: team.displayName ?? "Alabama Crimson Tide",
      abbreviation: team.abbreviation ?? "ALA",
      logo: team.logo ?? team.logos?.[0]?.href ?? null,
      color: team.color ? `#${team.color}` : "#9e1b32",
      record: team.recordSummary ?? recordFromGames(sorted),
      standing: team.standingSummary ?? null,
    },
    games: sorted,
  };
}

/** @param {Game[]} games */
function recordFromGames(games) {
  let w = 0;
  let l = 0;
  for (const g of games) {
    if (g.result?.outcome === "W") w++;
    if (g.result?.outcome === "L") l++;
  }
  return `${w}-${l}`;
}

/**
 * Picks the game to feature: one in progress, else the next one, else the last.
 * @param {Game[]} games
 * @param {Date} [now]
 */
export function featuredGame(games, now = new Date()) {
  const live = games.find((g) => g.status.state === "in");
  if (live) return { kind: /** @type {const} */ ("live"), game: live };
  const next = games.find((g) => g.status.state === "pre" && Date.parse(g.date ?? "") > now.getTime() - 6 * 3600_000);
  if (next) return { kind: /** @type {const} */ ("next"), game: next };
  const last = [...games].reverse().find((g) => g.status.state === "post");
  if (last) return { kind: /** @type {const} */ ("last"), game: last };
  return null;
}

/**
 * Full game page: box score, leaders, scoring summary, drives, win probability.
 * @param {any} json  /summary?event={id}
 * @param {NormalizeOptions} options
 */
export function normalizeSummary(json, options) {
  const header = json.header ?? {};
  const comp = header.competitions?.[0] ?? {};
  const game = normalizeEvent(
    {
      id: header.id ?? comp.id,
      date: comp.date,
      week: header.week ? { number: header.week } : undefined,
      seasonType: header.season ? { type: header.season.type } : undefined,
      competitions: [
        {
          ...comp,
          venue: comp.venue ?? json.gameInfo?.venue,
          situation: json.situation ?? comp.situation,
        },
      ],
    },
    options,
  );

  /** @param {string} id */
  const sideOf = (id) => (String(id) === game.home.id ? "home" : String(id) === game.away.id ? "away" : null);

  // Team stats as rows: { label, away, home }.
  const boxTeams = json.boxscore?.teams ?? [];
  const statsFor = (/** @type {string} */ id) =>
    boxTeams.find((/** @type {any} */ t) => String(t.team?.id) === id)?.statistics ?? [];
  const awayStats = statsFor(game.away.id);
  const homeStats = statsFor(game.home.id);
  const teamStats = (awayStats.length ? awayStats : homeStats).map((/** @type {any} */ s) => ({
    name: s.name,
    label: s.label ?? s.name,
    away: awayStats.find((/** @type {any} */ x) => x.name === s.name)?.displayValue ?? "–",
    home: homeStats.find((/** @type {any} */ x) => x.name === s.name)?.displayValue ?? "–",
  }));

  // Individual box score by team and category (passing, rushing, ...).
  /** @type {{ home: any[], away: any[] }} */
  const players = { home: [], away: [] };
  for (const entry of json.boxscore?.players ?? []) {
    const side = sideOf(entry.team?.id);
    if (!side) continue;
    for (const cat of entry.statistics ?? []) {
      players[side].push({
        category: cat.name,
        title: cat.text ?? cat.name,
        labels: cat.labels ?? [],
        athletes: (cat.athletes ?? []).map((/** @type {any} */ a) => ({
          name: a.athlete?.displayName ?? "",
          jersey: a.athlete?.jersey ?? null,
          stats: a.stats ?? [],
        })),
        totals: cat.totals ?? [],
      });
    }
  }

  // Game leaders: one row per category with each team's leader.
  /** @type {Map<string, { category: string, home: any, away: any }>} */
  const leaderRows = new Map();
  for (const teamLeaders of json.leaders ?? []) {
    const side = sideOf(teamLeaders.team?.id);
    if (!side) continue;
    for (const cat of teamLeaders.leaders ?? []) {
      const top = cat.leaders?.[0];
      if (!top) continue;
      const key = cat.name ?? cat.displayName;
      const row = leaderRows.get(key) ?? { category: cat.displayName ?? cat.name, home: null, away: null };
      row[side] = {
        name: top.athlete?.displayName ?? "",
        position: top.athlete?.position?.abbreviation ?? null,
        headshot: top.athlete?.headshot?.href ?? null,
        value: top.displayValue ?? "",
      };
      leaderRows.set(key, row);
    }
  }

  const scoringPlays = (json.scoringPlays ?? []).map((/** @type {any} */ p) => ({
    period: p.period?.number ?? null,
    clock: p.clock?.displayValue ?? null,
    team: p.team?.abbreviation ?? p.team?.displayName ?? "",
    side: sideOf(p.team?.id),
    type: p.type?.text ?? p.scoringType?.displayName ?? "",
    text: p.text ?? "",
    awayScore: p.awayScore ?? null,
    homeScore: p.homeScore ?? null,
  }));

  const rawDrives = [...(json.drives?.previous ?? [])];
  if (json.drives?.current && !rawDrives.some((d) => d.id === json.drives.current.id)) {
    rawDrives.push(json.drives.current);
  }
  const drives = rawDrives.map((/** @type {any} */ d) => ({
    team: d.team?.abbreviation ?? d.team?.displayName ?? "",
    side: sideOf(d.team?.id),
    quarter: d.start?.period?.number ?? null,
    start: d.start?.text ?? null,
    description: d.description ?? "",
    result: d.displayResult ?? d.result ?? "",
    isScore: Boolean(d.isScore),
    yards: d.yards ?? null,
    plays: d.offensivePlays ?? null,
    time: d.timeElapsed?.displayValue ?? null,
  }));

  // The summary doesn't always carry a situation block mid-game; fall back to
  // the current drive for the last play and to the header for possession.
  const lastDrivePlay = json.drives?.current?.plays?.at(-1)?.text ?? null;
  if (game.status.state === "in") {
    game.situation ??= {
      downDistance: null,
      possessionTeamId: game.home.possession ? game.home.id : game.away.possession ? game.away.id : null,
      isRedZone: false,
      lastPlay: null,
      homeTimeouts: null,
      awayTimeouts: null,
    };
    game.situation.lastPlay ??= lastDrivePlay;
  }

  const wp = json.winprobability?.at(-1);
  const winProbability =
    wp && Number.isFinite(wp.homeWinPercentage)
      ? {
          home: round1(wp.homeWinPercentage * 100),
          away: round1((1 - wp.homeWinPercentage - (wp.tiePercentage ?? 0)) * 100),
        }
      : null;

  const predictor = json.predictor
    ? {
        source: json.predictor.header ?? "ESPN FPI",
        home: Number(json.predictor.homeTeam?.gameProjection) || null,
        away: Number(json.predictor.awayTeam?.gameProjection) || null,
      }
    : null;

  const pick = json.pickcenter?.[0];
  return {
    ...game,
    odds: pick ? { details: pick.details ?? null, overUnder: pick.overUnder ?? null } : game.odds,
    teamStats,
    players,
    leaders: [...leaderRows.values()],
    scoringPlays,
    drives,
    winProbability,
    predictor,
    info: {
      attendance: json.gameInfo?.attendance ?? null,
      capacity: json.gameInfo?.venue?.capacity ?? null,
      weather: json.gameInfo?.weather
        ? [json.gameInfo.weather.displayValue, json.gameInfo.weather.temperature && `${json.gameInfo.weather.temperature}°`]
            .filter(Boolean)
            .join(", ")
        : null,
    },
  };
}

/** @param {number} n */
function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * @param {any} json  /scoreboard
 * @param {NormalizeOptions} options
 */
export function normalizeScoreboard(json, options) {
  const events = (json.events ?? []).map((/** @type {any} */ e) => normalizeEvent(e, options));
  const order = { in: 0, pre: 1, post: 2 };
  events.sort(
    (/** @type {Game} */ a, /** @type {Game} */ b) =>
      order[a.status.state] - order[b.status.state] || Date.parse(a.date ?? "") - Date.parse(b.date ?? ""),
  );
  return {
    season: json.season?.year ?? null,
    week: json.week?.number ?? null,
    events,
  };
}

/** @param {any} json  /rankings */
export function normalizeRankings(json) {
  return (json.rankings ?? []).map((/** @type {any} */ poll) => ({
    name: poll.name ?? "",
    shortName: poll.shortName ?? poll.name ?? "",
    headline: poll.headline ?? poll.shortHeadline ?? "",
    ranks: (poll.ranks ?? []).map((/** @type {any} */ r) => {
      const t = r.team ?? {};
      return {
        rank: r.current ?? null,
        previous: r.previous ?? null,
        trend: r.trend ?? null,
        points: r.points ?? null,
        firstPlaceVotes: r.firstPlaceVotes || null,
        record: r.recordSummary ?? null,
        team: {
          id: String(t.id ?? ""),
          name: t.displayName ?? ([t.location, t.name].filter(Boolean).join(" ") || t.nickname || ""),
          shortName: t.location ?? t.nickname ?? t.name ?? "",
          abbreviation: t.abbreviation ?? "",
          logo: t.logo ?? t.logos?.[0]?.href ?? null,
        },
      };
    }),
  }));
}

/** @param {any} json  /news */
export function normalizeNews(json) {
  return (json.articles ?? []).map((/** @type {any} */ a) => ({
    headline: a.headline ?? "",
    description: a.description ?? "",
    published: a.published ?? null,
    url: a.links?.web?.href ?? null,
    image: a.images?.[0]?.url ?? null,
  }));
}

/**
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   cache?: TtlCache,
 *   teamId: string,
 *   provider: Provider,
 * }} options
 */
export function createEspnClient({ fetchImpl = fetch, cache = new TtlCache(), teamId, provider }) {
  const opts = { teamId, provider };
  /**
   * @param {string} path
   * @param {number} ttlMs
   */
  const get = (path, ttlMs) => cache.get(`espn:${path}`, ttlMs, () => fetchJson(fetchImpl, "ESPN", BASE + path));

  return {
    /** @param {number} season */
    async schedule(season) {
      const path = `/college-football/teams/${teamId}/schedule?season=${season}`;
      const [regular, post] = await Promise.all([
        get(`${path}&seasontype=2`, 60_000),
        // Bowls/playoff aren't there until December; a failure here shouldn't
        // hide the regular season.
        get(`${path}&seasontype=3`, 60_000).catch(() => null),
      ]);
      return normalizeSchedule(regular, post, { ...opts, season });
    },

    /** @param {string} id */
    async game(id) {
      if (!/^\d+$/.test(id)) throw new RangeError("game id must be numeric");
      const json = await get(`/college-football/summary?event=${id}`, 15_000);
      return normalizeSummary(json, opts);
    },

    /**
     * @param {{
     *   league?: "college-football" | "nfl",
     *   scope?: "top25" | "sec" | "fbs",
     *   date?: string,
     *   week?: number,
     *   season?: number,
     * }} query
     */
    async scoreboard({ league = "college-football", scope = "top25", date, week, season } = {}) {
      const params = new URLSearchParams();
      if (league === "college-football") {
        if (scope === "sec") params.set("groups", "8");
        if (scope === "fbs") {
          params.set("groups", "80");
          params.set("limit", "300");
        }
      }
      if (date) {
        if (!/^\d{8}$/.test(date)) throw new RangeError("date must be YYYYMMDD");
        params.set("dates", date);
      } else if (week) {
        params.set("week", String(week));
        params.set("seasontype", "2");
        if (season) params.set("dates", String(season));
      }
      const qs = params.toString();
      const json = await get(`/${league}/scoreboard${qs ? `?${qs}` : ""}`, 15_000);
      return normalizeScoreboard(json, opts);
    },

    async rankings() {
      return normalizeRankings(await get("/college-football/rankings", 10 * 60_000));
    },

    /** @param {number} [limit] */
    async news(limit = 12) {
      const json = await get(`/college-football/news?team=${teamId}&limit=${Math.min(Math.max(limit, 1), 50)}`, 5 * 60_000);
      return normalizeNews(json);
    },
  };
}

/** @typedef {ReturnType<typeof createEspnClient>} EspnClient */
