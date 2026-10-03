import { getConfig, getJson } from "../api.js";
import { html, mount } from "../html.js";
import { kickoff, opponentOf, teamName, tvBadges } from "../format.js";
import { watchButtons } from "../components.js";

/** @param {import("../app.js").ViewContext} ctx */
export async function watchView(ctx) {
  const [config, schedule] = await Promise.all([getConfig(), getJson("/api/schedule")]);
  if (!ctx.isCurrent()) return;

  const upcoming = schedule.games.filter((/** @type {any} */ g) => g.status.state !== "post");

  mount(
    ctx.view,
    html`
      <div class="page-head"><h1>Where to watch</h1></div>

      <section class="card explainer">
        <h2>The short version</h2>
        <ul>
          <li><strong>ABC games are free.</strong> ABC is a broadcast network, so a TV antenna (a one-time purchase, no monthly bill) gets every Alabama game on ABC from your local station. CBS, FOX and NBC work the same way.</li>
          <li><strong>ESPN, ESPN2, ESPNU and SEC Network</strong> need a TV or live-streaming subscription that carries them, or an ESPN subscription, and stream in the ESPN app.</li>
          <li><strong>SEC Network+ / ESPN+</strong> games stream only in the ESPN app with an ESPN+ or ESPN subscription.</li>
          <li>There's no official one-time "season pass" for every Alabama game, and ABC/ESPN don't let other apps stream their games, so Bama Hub sends you to the official apps.</li>
        </ul>
        <p class="muted small">
          Your provider: <strong>${config.watch.providerLabel ?? (config.watch.provider === "antenna" ? "Antenna" : "ESPN app")}</strong>.
          Change it with WATCH_PROVIDER in the .env file (espn, youtubetv, hulu, fubo, sling, directv, antenna).
        </p>
      </section>

      ${upcoming.length
        ? upcoming.map((/** @type {any} */ g) => {
            const { opponent, prefix } = opponentOf(g);
            return html`<section class="card">
              <div class="watch-head">
                <div>
                  <h2><span class="vs">${prefix}</span> ${teamName(opponent)}</h2>
                  <p class="muted">${kickoff(g.date, g.timeTbd)}${g.headline ? ` · ${g.headline}` : ""}</p>
                </div>
                <span class="tv">${tvBadges(g.broadcasts)}</span>
              </div>
              ${watchButtons(g.watch)}
            </section>`;
          })
        : html`<div class="card"><p class="muted">No upcoming games this season.</p></div>`}
    `,
  );
}
