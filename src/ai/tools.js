// The tools Tide AI can call. Each one has a zod schema (sent to Claude as the
// tool's JSON Schema and used to validate what Claude sends back) and a run()
// that returns a JSON string for the tool_result.

import { z } from "zod";
import { CFBD_ENDPOINTS } from "../sources/cfbd.js";
import { currentSeason } from "../lib/season.js";

/** Tool results are capped so one huge query can't flood the context. */
export const MAX_RESULT_CHARS = 30_000;

/**
 * Serializes a tool result, trimming long arrays (and saying so) to fit.
 * @param {unknown} data
 * @param {number} [max]
 */
export function toResultText(data, max = MAX_RESULT_CHARS) {
  const full = JSON.stringify(data);
  if (full.length <= max) return full;
  if (Array.isArray(data)) {
    let lo = 0;
    let hi = data.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (JSON.stringify(data.slice(0, mid)).length <= max - 200) lo = mid;
      else hi = mid - 1;
    }
    return JSON.stringify({
      note: `Showing the first ${lo} of ${data.length} results. Narrow the query (team, year, week) for the rest.`,
      results: data.slice(0, lo),
    });
  }
  return JSON.stringify({
    note: "Result was too large and has been cut off. Narrow the query.",
    partial: full.slice(0, max - 200),
  });
}

/**
 * What the model needs from a game, without logos, colors and links.
 * @param {import("../sources/espn.js").Game} g
 */
export function compactGame(g) {
  /** @param {import("../sources/espn.js").TeamSide} t */
  const side = (t) => ({
    team: t.name,
    abbreviation: t.abbreviation,
    rank: t.rank,
    record: t.record,
    score: t.score,
  });
  return {
    id: g.id,
    date: g.date,
    timeTbd: g.timeTbd || undefined,
    week: g.weekText ?? g.week,
    headline: g.headline ?? undefined,
    status: g.status.detail,
    away: side(g.away),
    home: side(g.home),
    alabamaResult: g.result ?? undefined,
    tv: g.broadcasts,
    venue: [g.venue.name, g.venue.city, g.venue.state].filter(Boolean).join(", "),
    neutralSite: g.neutralSite || undefined,
    conferenceGame: g.conferenceGame || undefined,
    situation: g.situation ?? undefined,
    odds: g.odds ?? undefined,
  };
}

const NUMERIC_PARAMS = new Set(["year", "week", "id", "gameId", "minYear", "maxYear", "startWeek", "endWeek"]);
const ALL_CFBD_PARAMS = [...new Set(Object.values(CFBD_ENDPOINTS).flatMap((e) => e.params))].sort();

/** @type {Record<string, z.ZodType>} */
const cfbdParamShape = {};
for (const name of ALL_CFBD_PARAMS) {
  if (NUMERIC_PARAMS.has(name)) cfbdParamShape[name] = z.number().int().optional();
  else if (name === "excludeGarbageTime") cfbdParamShape[name] = z.boolean().optional();
  else if (name === "seasonType") cfbdParamShape[name] = z.enum(["regular", "postseason", "both"]).optional();
  else cfbdParamShape[name] = z.string().max(100).optional();
}

const endpointNames = /** @type {[import("../sources/cfbd.js").CfbdEndpoint, ...import("../sources/cfbd.js").CfbdEndpoint[]]} */ (
  Object.keys(CFBD_ENDPOINTS)
);

export const schemas = {
  get_alabama_schedule: z.strictObject({
    season: z
      .number()
      .int()
      .min(2000)
      .max(2100)
      .optional()
      .describe("Season year (the 2025 season includes its January bowl games). Defaults to the current season."),
  }),
  get_scoreboard: z.strictObject({
    league: z.enum(["college-football", "nfl"]).optional().describe("Defaults to college-football."),
    scope: z
      .enum(["top25", "sec", "fbs"])
      .optional()
      .describe("College only: top25 (default), sec, or every fbs game."),
    date: z
      .string()
      .regex(/^\d{8}$/)
      .optional()
      .describe("A single day as YYYYMMDD. Omit for the current week."),
    week: z.number().int().min(1).max(20).optional().describe("Regular-season week number instead of a date."),
    season: z.number().int().min(2000).max(2100).optional().describe("Season for the week number."),
  }),
  get_game_details: z.strictObject({
    game_id: z.string().regex(/^\d+$/).describe("ESPN game id from get_alabama_schedule or get_scoreboard."),
  }),
  get_rankings: z.strictObject({}),
  get_alabama_news: z.strictObject({
    limit: z.number().int().min(1).max(20).optional().describe("How many headlines (default 8)."),
  }),
  college_football_data: z.strictObject({
    endpoint: z.enum(endpointNames),
    params: z
      .strictObject(cfbdParamShape)
      .describe("Query parameters. Only the ones the chosen endpoint lists are accepted. Team names like 'Alabama', 'Auburn', 'Ole Miss'."),
  }),
  search_bama_knowledge: z.strictObject({
    query: z.string().min(2).max(300).describe("Keywords, e.g. 'Iron Bowl Kick Six' or 'national championships'."),
  }),
};

/** @typedef {keyof typeof schemas} ToolName */

/** @type {Record<ToolName, string>} */
const descriptions = {
  get_alabama_schedule:
    "Alabama's full schedule for a season from ESPN: dates, opponents, ranks, results, TV network, venue, and live status. Use for anything about Alabama's games this season, next game, or record.",
  get_scoreboard:
    "Live and final scores from ESPN for college football (Top 25, SEC, or all FBS) or the NFL, for the current week or a given date/week. Includes down & distance for games in progress.",
  get_game_details:
    "Full box score for one college game from ESPN: team stats, player stats, leaders, scoring summary, drives, win probability. Works for live and finished games. Not for NFL games.",
  get_rankings: "Current college football polls from ESPN (AP Top 25, Coaches Poll, and CFP rankings when released).",
  get_alabama_news: "Latest Alabama football headlines from ESPN.",
  college_football_data:
    "Query the CollegeFootballData.com database: every game since 1869, records, head-to-head series, team and player season stats, advanced stats, SP+/Elo ratings, polls, rosters, coaches, recruiting and NFL draft picks. Endpoints:\n" +
    Object.entries(CFBD_ENDPOINTS)
      .map(([path, spec]) => `${path} (${spec.params.join(", ") || "no params"}): ${spec.about}`)
      .join("\n"),
  search_bama_knowledge:
    "Search the app's curated Alabama football reference: championships, Heisman winners, coaches, traditions, rivalries, famous games, stadium, and how to watch or listen.",
};

/** @type {Record<ToolName | "web_search", string>} */
export const TOOL_STATUS = {
  get_alabama_schedule: "Checking the schedule",
  get_scoreboard: "Checking scores",
  get_game_details: "Pulling the box score",
  get_rankings: "Checking the polls",
  get_alabama_news: "Reading the latest news",
  college_football_data: "Searching the college football database",
  search_bama_knowledge: "Looking through Bama history",
  web_search: "Searching the web",
};

/** @param {z.ZodType} schema */
function jsonSchema(schema) {
  const { $schema: _ignored, ...rest } = /** @type {Record<string, unknown>} */ (z.toJSONSchema(schema));
  return /** @type {import("@anthropic-ai/sdk").Anthropic.Beta.BetaTool.InputSchema} */ (rest);
}

/**
 * @param {{
 *   espn: import("../sources/espn.js").EspnClient,
 *   cfbd: import("../sources/cfbd.js").CfbdClient,
 *   knowledge: import("../sources/knowledge.js").KnowledgeIndex,
 *   webSearch: boolean,
 *   now?: () => Date,
 * }} deps
 */
export function createToolkit({ espn, cfbd, knowledge, webSearch, now = () => new Date() }) {
  /** @type {{ [K in ToolName]: (input: z.infer<(typeof schemas)[K]>) => Promise<unknown> }} */
  const handlers = {
    async get_alabama_schedule({ season }) {
      const s = await espn.schedule(season ?? currentSeason(now()));
      return { season: s.season, team: s.team.name, record: s.team.record, standing: s.team.standing, games: s.games.map(compactGame) };
    },
    async get_scoreboard(input) {
      const board = await espn.scoreboard(input);
      return { season: board.season, week: board.week, games: board.events.map(compactGame) };
    },
    async get_game_details({ game_id }) {
      const g = await espn.game(game_id);
      return {
        ...compactGame(g),
        quarterScores: { away: g.away.linescores, home: g.home.linescores },
        winProbability: g.winProbability,
        pregamePredictor: g.predictor,
        teamStats: g.teamStats.map((s) => ({ stat: s.label, away: s.away, home: s.home })),
        leaders: g.leaders.map((l) => ({
          category: l.category,
          away: l.away && `${l.away.name}: ${l.away.value}`,
          home: l.home && `${l.home.name}: ${l.home.value}`,
        })),
        scoringPlays: g.scoringPlays,
        drives: g.drives,
        players: g.players,
        info: g.info,
        source: g.links.espn,
      };
    },
    async get_rankings() {
      const polls = await espn.rankings();
      return polls.map((p) => ({
        poll: p.name,
        headline: p.headline,
        ranks: p.ranks.map((r) => ({
          rank: r.rank,
          team: r.team.name,
          record: r.record,
          previous: r.previous,
          points: r.points,
          firstPlaceVotes: r.firstPlaceVotes ?? undefined,
        })),
      }));
    },
    async get_alabama_news({ limit }) {
      const news = await espn.news(limit ?? 8);
      return news.map(({ image: _image, ...rest }) => rest);
    },
    async college_football_data({ endpoint, params }) {
      return cfbd.query(endpoint, /** @type {Record<string, string | number | boolean>} */ (params));
    },
    async search_bama_knowledge({ query }) {
      const hits = knowledge.search(query, 4);
      return hits.length > 0 ? hits : { note: "No matching entries in the local reference. Try other keywords or another tool." };
    },
  };

  /** @type {import("@anthropic-ai/sdk").Anthropic.Beta.BetaToolUnion[]} */
  const definitions = (/** @type {ToolName[]} */ (Object.keys(schemas))).map((name) => ({
    name,
    description: descriptions[name],
    input_schema: jsonSchema(schemas[name]),
    // Streamed requests: let tool input stream as it's generated. run() below
    // validates it, since the API doesn't when this is on.
    eager_input_streaming: true,
  }));
  if (webSearch) {
    definitions.push({ type: "web_search_20260209", name: "web_search", max_uses: 5 });
  }

  /**
   * Validates and runs one tool call. Never throws: failures come back as
   * is_error results so Claude can recover or explain.
   * @param {string} name
   * @param {unknown} input
   * @returns {Promise<{ content: string, isError: boolean }>}
   */
  async function run(name, input) {
    if (!Object.hasOwn(schemas, name)) {
      return { content: `Unknown tool: ${name}`, isError: true };
    }
    const toolName = /** @type {ToolName} */ (name);
    const parsed = schemas[toolName].safeParse(input);
    if (!parsed.success) {
      return {
        content: `Invalid input: ${z.prettifyError(parsed.error)}\nReceived: ${JSON.stringify(input)}`,
        isError: true,
      };
    }
    try {
      const handler = /** @type {(input: unknown) => Promise<unknown>} */ (handlers[toolName]);
      return { content: toResultText(await handler(parsed.data)), isError: false };
    } catch (err) {
      return { content: `Tool failed: ${/** @type {Error} */ (err).message}`, isError: true };
    }
  }

  return { definitions, run };
}

/** @typedef {ReturnType<typeof createToolkit>} Toolkit */
