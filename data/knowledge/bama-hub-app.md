# Using Bama Hub

## Pages

- Home: the next (or live) Alabama game with a countdown, the season record and poll ranking, recent results, and the latest headlines.
- Schedule: every game this season with kickoff time, TV network, result, and buttons to watch, listen, or open the Game Center.
- Game Center: live score, down and distance, win probability, team stats side by side, game leaders, scoring summary, drives, and the full box score. Refreshes itself every 15 seconds while a game is live.
- Scores: Top 25, SEC, all FBS, or NFL scoreboards.
- Polls: the AP Top 25 and other polls, with Alabama highlighted.
- Watch: where each game airs and the legitimate ways to watch it.
- Radio: plays the configured radio stream with a delay slider to sync it to TV, and links to official places to listen.
- Tide AI: this assistant.

## Settings (the .env file)

- WATCH_PROVIDER picks which live-TV service the Watch buttons point to: espn, youtubetv, hulu, fubo, sling, directv, or antenna.
- RADIO_STREAM_URL sets the radio stream for the Radio page.
- ALLOWED_IPS and ALLOWED_HOSTNAMES control which computers may open the app (by default only the machine running it). The owner's home computer, juno, is meant to be the one allowed machine.
- CFBD_API_KEY turns on CollegeFootballData.com lookups for history and stats (free key at collegefootballdata.com/key).
- ANTHROPIC_API_KEY turns on Tide AI.
- After editing .env, restart the app.
