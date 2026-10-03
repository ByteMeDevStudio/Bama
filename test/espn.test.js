import test from "node:test";
import assert from "node:assert/strict";
import {
  createEspnClient,
  featuredGame,
  normalizeNews,
  normalizeRankings,
  normalizeSchedule,
  normalizeScoreboard,
  normalizeSummary,
} from "../src/sources/espn.js";
import { TtlCache } from "../src/lib/cache.js";
import { fakeFetch, fixture } from "./helpers.js";

const opts = { teamId: "333", provider: /** @type {const} */ ("youtubetv") };

test("schedule: results from Alabama's side, TV without radio, ranks, TBA times", () => {
  const s = normalizeSchedule(fixture("espn-schedule.json"), null, { ...opts, season: 2026 });
  assert.equal(s.team.record, "4-1");
  assert.equal(s.team.standing, "3rd in SEC");
  assert.equal(s.games.length, 3);

  const [opener, road, tenn] = s.games;
  assert.equal(opener.alabama, "home");
  assert.deepEqual(opener.result, { outcome: "W", score: "42-10" });
  assert.deepEqual(opener.broadcasts, ["SECN"]);
  assert.equal(opener.home.rank, 7);
  assert.equal(opener.away.rank, null, "ESPN's 99 means unranked");
  assert.equal(opener.home.record, "1-0");
  assert.equal(opener.venue.city, "Tuscaloosa");

  assert.equal(road.alabama, "away");
  assert.deepEqual(road.result, { outcome: "L", score: "21-24" });

  assert.equal(tenn.status.state, "pre");
  assert.equal(tenn.timeTbd, true);
  assert.equal(tenn.home.score, null);
  assert.equal(tenn.result, null);
  assert.equal(tenn.conferenceGame, true);
  assert.equal(tenn.watch[0].kind, "free", "ABC games lead with the free antenna option");
  assert.ok(tenn.watch.some((w) => w.label.startsWith("YouTube TV")));
});

test("schedule merges postseason and de-duplicates", () => {
  const regular = fixture("espn-schedule.json");
  const post = { events: [regular.events[2], { ...regular.events[0], id: "401899999", date: "2027-01-01T21:00Z", seasonType: { type: 3 } }] };
  const s = normalizeSchedule(regular, post, { ...opts, season: 2026 });
  assert.equal(s.games.length, 4);
  assert.equal(s.games.at(-1)?.id, "401899999");
});

test("featuredGame prefers live, then next, then last", () => {
  const { games } = normalizeSchedule(fixture("espn-schedule.json"), null, { ...opts, season: 2026 });
  const now = new Date("2026-10-03T12:00:00Z");
  assert.equal(featuredGame(games, now)?.kind, "next");
  assert.equal(featuredGame(games, now)?.game.id, "401800003");

  const live = games.map((g, i) => (i === 1 ? { ...g, status: { ...g.status, state: /** @type {const} */ ("in") } } : g));
  assert.equal(featuredGame(live, now)?.kind, "live");

  const allDone = games.slice(0, 2);
  assert.equal(featuredGame(allDone, now)?.kind, "last");
  assert.equal(featuredGame([], now), null);
});

test("scoreboard: string scores, logos, live situation, broadcast name lists, live games first", () => {
  const board = normalizeScoreboard(fixture("espn-scoreboard.json"), opts);
  assert.equal(board.week, 6);
  assert.deepEqual(
    board.events.map((e) => e.status.state),
    ["in", "pre", "post"],
  );
  const live = board.events[0];
  assert.equal(live.home.score, 28);
  assert.equal(live.away.score, 24);
  assert.equal(live.home.logo, "https://a.espncdn.com/i/teamlogos/ncaa/500/145.png");
  assert.equal(live.home.color, "#13294b");
  assert.deepEqual(live.home.linescores, [7, 14, 7]);
  assert.equal(live.away.record, "4-1");
  assert.equal(live.situation?.downDistance, "3rd & 4 at MISS 38");
  assert.equal(live.situation?.possessionTeamId, "61");
  assert.deepEqual(live.broadcasts, ["ESPN"]);
  assert.equal(live.alabama, null);

  const pre = board.events[1];
  assert.equal(pre.home.score, null, "pregame 0-0 is hidden");
  assert.deepEqual(pre.broadcasts, ["ABC"], "falls back to geoBroadcasts");
});

test("summary: game center data", () => {
  const g = normalizeSummary(fixture("espn-summary.json"), opts);
  assert.equal(g.id, "401800004");
  assert.equal(g.status.state, "in");
  assert.equal(g.home.rank, 6);
  assert.equal(g.home.possession, true);
  assert.deepEqual(g.home.linescores, [7, 10]);
  assert.equal(g.venue.name, "Bryant-Denny Stadium");
  assert.deepEqual(g.broadcasts, ["ABC"]);

  assert.deepEqual(g.teamStats[1], { name: "totalYards", label: "Total Yards", away: "240", home: "331" });
  assert.equal(g.players.home[0].athletes[0].name, "Tide Quarterback");
  assert.equal(g.players.away[0].category, "rushing");
  assert.equal(g.leaders[0].home.name, "Tide Quarterback");
  assert.equal(g.leaders[0].away.value, "9/18, 99 YDS");

  assert.equal(g.scoringPlays.length, 2);
  assert.equal(g.scoringPlays[0].side, "home");
  assert.equal(g.scoringPlays[1].team, "AUB");

  assert.equal(g.drives.length, 2, "previous drives plus the current one");
  assert.equal(g.drives[0].result, "Touchdown");
  assert.equal(g.situation?.lastPlay, "Tide Quarterback pass complete to the AUB 48 for 6 yards.");

  assert.deepEqual(g.winProbability, { home: 74.2, away: 25.8 });
  assert.deepEqual(g.odds, { details: "ALA -13.5", overUnder: 48.5 });
  assert.equal(g.info.attendance, 100077);
  assert.equal(g.info.weather, "Sunny, 78°");
});

test("summary survives a nearly empty payload", () => {
  const g = normalizeSummary({ header: { id: "1", competitions: [{}] } }, opts);
  assert.equal(g.id, "1");
  assert.deepEqual(g.teamStats, []);
  assert.deepEqual(g.drives, []);
  assert.equal(g.winProbability, null);
});

test("rankings and news", () => {
  const [ap] = normalizeRankings(fixture("espn-rankings.json"));
  assert.equal(ap.name, "AP Top 25");
  assert.equal(ap.ranks[1].team.name, "Alabama Crimson Tide");
  assert.equal(ap.ranks[1].team.logo, "https://a.espncdn.com/i/teamlogos/ncaa/500/333.png");
  assert.equal(ap.ranks[0].firstPlaceVotes, 50);
  assert.equal(ap.ranks[1].firstPlaceVotes, null);

  const news = normalizeNews(fixture("espn-news.json"));
  assert.equal(news[0].url, "https://www.espn.com/college-football/story/_/id/1");
  assert.equal(news[1].url, null);
});

test("client builds the right ESPN URLs and caches", async () => {
  const fetchImpl = fakeFetch({
    "/teams/333/schedule?season=2026&seasontype=2": fixture("espn-schedule.json"),
    "/teams/333/schedule?season=2026&seasontype=3": { events: [] },
    "/summary?event=401800004": fixture("espn-summary.json"),
    "/scoreboard": fixture("espn-scoreboard.json"),
    "/rankings": fixture("espn-rankings.json"),
    "/news": fixture("espn-news.json"),
  });
  const espn = createEspnClient({ fetchImpl, cache: new TtlCache(), ...opts });

  await espn.schedule(2026);
  await espn.schedule(2026);
  assert.equal(fetchImpl.calls.length, 2, "regular + postseason, then served from cache");

  await espn.game("401800004");
  await assert.rejects(espn.game("../../etc"), RangeError);

  await espn.scoreboard({ scope: "sec", date: "20261003" });
  assert.match(fetchImpl.calls.at(-1)?.url ?? "", /college-football\/scoreboard\?groups=8&dates=20261003$/);
  await espn.scoreboard({ scope: "fbs", week: 6, season: 2026 });
  assert.match(fetchImpl.calls.at(-1)?.url ?? "", /groups=80&limit=300&week=6&seasontype=2&dates=2026$/);
  await espn.scoreboard({ league: "nfl" });
  assert.match(fetchImpl.calls.at(-1)?.url ?? "", /football\/nfl\/scoreboard$/);
  await assert.rejects(espn.scoreboard({ date: "2026-10-03" }), RangeError);

  const news = await espn.news(500);
  assert.equal(news.length, 2);
  assert.match(fetchImpl.calls.at(-1)?.url ?? "", /news\?team=333&limit=50$/);
});

test("a missing postseason doesn't break the schedule", async () => {
  const fetchImpl = fakeFetch((url) => (url.includes("seasontype=2") ? fixture("espn-schedule.json") : undefined));
  const espn = createEspnClient({ fetchImpl, cache: new TtlCache(), ...opts });
  const s = await espn.schedule(2026);
  assert.equal(s.games.length, 3);
});

test("upstream errors name the service", async () => {
  const espn = createEspnClient({ fetchImpl: fakeFetch({}), cache: new TtlCache(), ...opts });
  await assert.rejects(espn.rankings(), /ESPN: HTTP 404/);
});
