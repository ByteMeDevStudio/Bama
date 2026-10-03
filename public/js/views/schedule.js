import { getConfig, getJson } from "../api.js";
import { html, mount } from "../html.js";
import { scheduleRow } from "../components.js";

/** @param {import("../app.js").ViewContext} ctx */
export async function scheduleView(ctx) {
  const config = await getConfig();
  const requested = Number(ctx.query.get("season"));
  const season = Number.isInteger(requested) && requested >= 2000 ? requested : config.season;
  const schedule = await getJson(`/api/schedule?season=${season}`);
  if (!ctx.isCurrent()) return;

  const regular = schedule.games.filter((/** @type {any} */ g) => g.seasonType !== 3);
  const post = schedule.games.filter((/** @type {any} */ g) => g.seasonType === 3);
  const seasons = Array.from({ length: 8 }, (_, i) => config.season - i);

  mount(
    ctx.view,
    html`
      <div class="page-head">
        <div>
          <h1>${season} Schedule</h1>
          <p class="muted">${schedule.team.record ? `Record: ${schedule.team.record}` : ""}${schedule.team.standing ? ` · ${schedule.team.standing}` : ""}</p>
        </div>
        <label class="select">
          <span class="sr-only">Season</span>
          <select id="season">
            ${seasons.map((s) => html`<option value="${s}" ${s === season ? html`selected` : ""}>${s}</option>`)}
          </select>
        </label>
      </div>
      <section class="card">
        ${regular.length ? html`<div class="sched-list">${regular.map(scheduleRow)}</div>` : html`<p class="muted">No regular-season games found.</p>`}
      </section>
      ${post.length
        ? html`<section class="card"><h2>Postseason</h2><div class="sched-list">${post.map(scheduleRow)}</div></section>`
        : ""}
      <p class="muted small">Times are shown in your computer's time zone. TV networks for SEC games are usually announced 6–12 days before kickoff.</p>
    `,
  );

  ctx.view.querySelector("#season")?.addEventListener("change", (e) => {
    const value = /** @type {HTMLSelectElement} */ (e.target).value;
    location.hash = Number(value) === config.season ? "#/schedule" : `#/schedule?season=${value}`;
  });
}
