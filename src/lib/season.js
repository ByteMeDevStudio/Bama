/**
 * The college football season a date belongs to. Bowls and the playoff run
 * into January, so January still counts as the previous season.
 * @param {Date} [date]
 */
export function currentSeason(date = new Date()) {
  const year = date.getFullYear();
  return date.getMonth() === 0 ? year - 1 : year;
}

/**
 * YYYYMMDD in the given time zone (ESPN's `dates=` format).
 * @param {Date} date
 * @param {string} timeZone
 */
export function espnDate(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return parts.replaceAll("-", "");
}
