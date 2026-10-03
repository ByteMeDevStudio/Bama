# Bama Hub

An unofficial Alabama Crimson Tide football app for your home computer, with:

- **Home:** next game with a countdown, or the live score if a game is on; record, AP rank, recent results and news.
- **Schedule:** every game this season (and past seasons) with kickoff time, TV network and result.
- **Game Center:** live score, down and distance, last play, win probability, team stats, leaders, scoring summary, drives and the full box score. Refreshes every 15 seconds during a game.
- **Scores:** Top 25, SEC, all FBS, or NFL, for this week or any date.
- **Polls:** AP Top 25, Coaches and CFP rankings, with Alabama highlighted.
- **Watch:** where each game airs and the legitimate ways to watch it. ABC games are free with an antenna.
- **Radio:** plays a Crimson Tide Sports Network stream with a **delay slider to sync the radio call with your TV**, and keeps playing while you browse other pages. Also lists the official ways to listen.
- **Tide AI:** a Claude-powered assistant that pulls live ESPN data, the CollegeFootballData.com database (every game since 1869), a built-in Alabama history reference, and the web.

Bama Hub only accepts connections from the computer it runs on, plus any machine you list (juno). Everyone else gets `403 Forbidden`.

> Not affiliated with The University of Alabama, ESPN/ABC, Learfield or the Crimson Tide Sports Network.

## What's possible, and what isn't

Some of what was asked for has no official API. Here's how the app handles each one:

| Wanted | Reality | What Bama Hub does |
|---|---|---|
| Stream ABC/ESPN games in the app, even for a one-time payment | ABC/ESPN have no streaming API for other apps, and there's no official one-time "season pass" for every Alabama game. | Shows each game's network and links to the official apps. Points out that **ABC games are free with an antenna**, which is the closest thing to a one-time payment. |
| Crimson Tide Sports Network radio API | No public API. Official audio is on local stations, RollTide.com and official apps, and SiriusXM. | Plays any stream URL you're entitled to (`RADIO_STREAM_URL`), adds the TV-sync delay, and links to the official sources. |
| NCAA live scores and stats | NCAA.com has no official public API. ESPN's site API is open, though unofficial. | Uses ESPN for live scores and box scores, and CollegeFootballData.com (free key) for history and deep stats. |
| AI trained on NCAA football | Training a model isn't needed. A model that looks things up stays current every week. | Tide AI is Claude with tools: it queries ESPN, CollegeFootballData.com and the local Alabama reference, and can search the web. |

ESPN's API is undocumented and can change without notice. If a page starts showing errors after an ESPN change, the parsing lives in `src/sources/espn.js`.

## Setup

You need [Node.js](https://nodejs.org) 20.12 or newer.

```bash
npm install
cp .env.example .env     # then edit .env
npm start
```

Open <http://localhost:3000>.

### Keys (both optional; the app runs without them)

- `ANTHROPIC_API_KEY` turns on Tide AI. Get one at <https://platform.claude.com>. Usage is billed per question (usually cents; answers that need many lookups cost more), and `AI_RATE_LIMIT_PER_HOUR` caps it.
- `CFBD_API_KEY` lets Tide AI answer history and stats questions. It's free at <https://collegefootballdata.com/key>; the free tier allows about 1,000 calls a month, and Bama Hub caches results.

### Letting juno in

**If Bama Hub runs on juno itself**, you're done. The default `HOST=127.0.0.1` means it only listens on juno, and only juno can connect.

**If it runs on another machine** (a home server, a Raspberry Pi) and you browse from juno:

1. Find juno's IP address. Windows: `ipconfig`. macOS: `ipconfig getifaddr en0`. Linux: `hostname -I`.
2. In `.env` on the server:
   ```
   HOST=0.0.0.0
   ALLOWED_IPS=192.168.1.50        # juno's address
   ALLOWED_HOSTNAMES=juno.local    # optional: follows juno if its IP changes
   ```
3. Restart, then open `http://<server-ip>:3000` on juno.

Hostnames in `ALLOWED_HOSTNAMES` are re-resolved every 5 minutes, and immediately when an unknown address knocks, so a new DHCP lease on juno doesn't lock you out. A DHCP reservation on your router keeps juno's IP fixed. If DNS fails, the last known address keeps working.

Behind a reverse proxy? Set `TRUST_PROXY=1` (the number of proxy hops). Leave it empty otherwise; turning it on without a proxy would let anyone claim to be juno with a forged `X-Forwarded-For` header.

### Radio

Put a live-audio URL you're entitled to use in `RADIO_STREAM_URL`. Plain MP3/AAC (Icecast/Shoutcast) streams work best. The stream is relayed through Bama Hub so the browser can delay it: hit play, then slide the delay until the radio call matches your TV. Streaming TV usually needs 30–60 seconds; antenna or cable, a few. Only the URL in `.env` is ever fetched; the browser can't make the relay fetch anything else.

## How Tide AI works

Tide AI runs on the Claude API (`claude-opus-5-5` by default) with these tools:

| Tool | Source |
|---|---|
| `get_alabama_schedule`, `get_scoreboard`, `get_game_details`, `get_rankings`, `get_alabama_news` | ESPN (live) |
| `college_football_data` | CollegeFootballData.com: games since 1869, records, head-to-head series, team and player stats, advanced stats, SP+/Elo, polls, rosters, coaches, recruiting, NFL draft |
| `search_bama_knowledge` | `data/knowledge/*.md`: championships, Heisman winners, coaches, traditions, rivalries, famous games, how to watch and listen |
| `web_search` | Claude's built-in web search, for news and injuries (`AI_WEB_SEARCH=false` turns it off) |

Answers stream into the page as they're written. The server keeps each conversation's history (append-only, with an unchanging system prompt and tool list, so prompt caching keeps follow-ups cheap). If Claude's safety system declines a request, server-side fallback (`fallbacks: "default"`) retries it on Anthropic's recommended fallback model before giving up.

To teach Tide AI more, add or edit markdown files in `data/knowledge/` and restart. Keep them to settled facts; anything that changes week to week should come from the live tools.

## Project layout

```
src/
  server.js              entry point: loads .env, wires everything, listens
  app.js                 Express app: allowlist -> security headers -> API -> static files
  config.js              .env settings
  security/ipAllowlist.js  IP/CIDR/hostname allowlist (juno)
  security/headers.js    CSP and other headers
  sources/espn.js        ESPN client and normalizers
  sources/cfbd.js        CollegeFootballData.com client (allowlisted endpoints)
  sources/knowledge.js   markdown knowledge base with BM25 search
  watch.js               network -> where-to-watch options
  ai/                    Tide AI: system prompt, tools, streaming tool loop
  routes/api.js          JSON API, chat stream, radio relay
public/                  the web app (plain HTML/CSS/JS, no build step)
data/knowledge/          Tide AI's Alabama reference
test/                    node:test suites with ESPN fixtures
```

## Development

```bash
npm run dev        # restart on file changes
npm test           # unit and API tests (no network needed)
npm run typecheck  # TypeScript checking of the JSDoc-typed JavaScript
npm run check      # both
```
