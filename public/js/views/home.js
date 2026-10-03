import { getJson } from "../api.js";
import { html, mount, safeUrl } from "../html.js";
import { ALABAMA_ID, countdown, opponentOf, resultBadge, timeAgo, teamName, shortDate } from "../format.js";
import { gameMeta, matchupHeader, scheduleRow, watchButtons, winProbBar } from "../components.js";

/** @param {import("../app.js").ViewContext} ctx */
export async function homeView(ctx) {
  const [schedule, news, polls] = await Promise.all([
    getJson("/api/schedule"),
    getJson("/api/news?limit=6").catch(() => []),
    getJson("/api/rankings").catch(() => []),
  ]);
  if (!ctx.isCurrent()) return;

  const games = schedule.games;
  const featured = schedule.featured ? games.find((/** @type {any} */ g) => g.id === schedule.featured.gameId) : null;
  const ap = polls.find((/** @type {any} */ p) => /\bAP\b/i.test(p.name));
  const apRank = ap?.ranks.find((/** @type {any} */ r) => r.team.id === ALABAMA_ID)?.rank ?? null;
  const results = games.filter((/** @type {any} */ g) => g.status.state === "post").slice(-3).reverse();
  const upcoming = games.filter((/** @type {any} */ g) => g.status.state === "pre" && g.id !== featured?.id).slice(0, 3);

  mount(
    ctx.view,
    html`
      <section id="hero">${featured ? hero(featured, schedule.featured.kind) : html`<div class="card">No games on the ${schedule.season} schedule yet.</div>`}</section>

      <section class="stat-tiles">
        <div class="tile">
          <small>${schedule.season} record</small>
          <strong>${schedule.team.record ?? "0-0"}</strong>
          <span class="muted">${schedule.team.standing ?? ""}</span>
        </div>
        <div class="tile">
          <small>AP poll</small>
          <strong>${apRank ? `#${apRank}` : "NR"}</strong>
          <span class="muted">${ap ? ap.headline.replace(/^.*?(Week \d+|Preseason|Final).*$/i, "$1") : ""}</span>
        </div>
        <a class="tile tile-link" href="#/ai">
          <small>Ask Tide AI</small>
          <strong>Got a question?</strong>
          <span class="muted">Stats, history, matchups →</span>
        </a>
      </section>

      <div class="grid two">
        <section class="card">
          <h2>Recent results</h2>
          ${results.length ? html`<div class="sched-list">${results.map(scheduleRow)}</div>` : html`<p class="muted">No games played yet.</p>`}
        </section>
        <section class="card">
          <h2>Coming up</h2>
          ${upcoming.length ? html`<div class="sched-list">${upcoming.map(scheduleRow)}</div>` : html`<p class="muted">Nothing else scheduled.</p>`}
          <p><a href="#/schedule">Full schedule →</a></p>
        </section>
      </div>

      <section class="card">
        <h2>Latest news</h2>
        ${news.length
          ? html`<ul class="news">
              ${news.map((/** @type {any} */ a) => {
                const url = safeUrl(a.url);
                const img = safeUrl(a.image);
                return html`<li>
                  ${img ? html`<img src="${img}" alt="" loading="lazy" />` : ""}
                  <div>
                    ${url ? html`<a href="${url}" target="_blank" rel="noopener noreferrer">${a.headline}</a>` : html`<strong>${a.headline}</strong>`}
                    <small class="muted">${timeAgo(a.published)}</small>
                    <p>${a.description}</p>
                  </div>
                </li>`;
              })}
            </ul>`
          : html`<p class="muted">News isn't available right now.</p>`}
      </section>
    `,
  );

  if (!featured) return;
  const heroEl = /** @type {HTMLElement} */ (ctx.view.querySelector("#hero"));

  if (schedule.featured.kind === "next") {
    const tick = () => {
      const el = heroEl.querySelector("[data-countdown]");
      if (el) el.textContent = featured.timeTbd ? "Kickoff time TBA" : countdown(Date.parse(featured.date) - Date.now());
    };
    tick();
    const timer = setInterval(tick, 1000);
    ctx.onCleanup(() => clearInterval(timer));
  }

  if (schedule.featured.kind === "live") {
    const refresh = async () => {
      try {
        const game = await getJson(`/api/games/${featured.id}`);
        if (ctx.isCurrent()) mount(heroEl, hero(game, game.status.state === "in" ? "live" : "last"));
      } catch {
        // keep showing the last good score
      }
    };
    void refresh();
    const timer = setInterval(refresh, 20_000);
    ctx.onCleanup(() => clearInterval(timer));
  }
}

/**
 * @param {any} game
 * @param {"live" | "next" | "last"} kind
 */
function hero(game, kind) {
  const label = { live: "Live now", next: "Next game", last: "Last game" }[kind];
  const { opponent, prefix } = opponentOf(game);
  return html`
    <div class="card hero ${kind === "live" ? "is-live" : ""}">
      <div class="hero-top">
        <span class="pill ${kind}">${kind === "live" ? html`<span class="dot"></span>` : ""}${label}</span>
        ${game.headline ? html`<span class="muted">${game.headline}</span>` : ""}
      </div>
      ${matchupHeader(game)}
      ${kind === "next"
        ? html`
            <div class="hero-countdown"><small>Kickoff in</small><strong data-countdown></strong></div>
            ${gameMeta(game)}
            ${watchButtons(game.watch, 3)}`
        : ""}
      ${kind === "live"
        ? html`
            ${game.situation
              ? html`<div class="situation">
                  ${game.situation.downDistance ? html`<strong>${game.situation.downDistance}</strong>` : ""}
                  ${game.situation.isRedZone ? html`<span class="redzone">Red zone</span>` : ""}
                  ${game.situation.lastPlay ? html`<p>${game.situation.lastPlay}</p>` : ""}
                </div>`
              : ""}
            ${winProbBar(game, game.winProbability, "Win probability")}`
        : ""}
      ${kind === "last" && game.result
        ? html`<p class="hero-result">${resultBadge(game.result)} ${prefix} ${teamName(opponent)} · ${shortDate(game.date)}</p>`
        : ""}
      <div class="actions">
        <a class="btn primary" href="#/game/${game.id}">${kind === "next" ? "Game preview" : "Game Center"}</a>
        <a class="btn" href="#/radio">Listen live</a>
        <a class="btn" href="#/watch">Where to watch</a>
      </div>
    </div>`;
}

