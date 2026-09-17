import * as cheerio from "cheerio";
import { EVENT_TIMEZONE_OFFSET, HORIZON_DAYS, LEEKDUCK_EVENTS_URL } from "./config.mjs";

const clean = value => String(value || "").replace(/\s+/g, " ").trim();
const MONTHS = new Map([
  ["jan", 0], ["feb", 1], ["mar", 2], ["apr", 3], ["may", 4], ["jun", 5],
  ["jul", 6], ["aug", 7], ["sep", 8], ["oct", 9], ["nov", 10], ["dec", 11]
]);

// LeekDuck's index compacts its event-card text. A date may be inside the link
// itself or inside one of its first few small parent containers.
const DATE_PATTERN = /(?:Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?),?\s+([A-Z][a-z]+)\s+(\d{1,2}),?\s+at\s+(\d{1,2}):(\d{2})\s*([AP]M)(?:\s+Local\s+Time)?/i;

function localEventDate(year, monthIndex, day, hour, minute) {
  const month = String(monthIndex + 1).padStart(2, "0");
  const date = String(day).padStart(2, "0");
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return new Date(`${year}-${month}-${date}T${hh}:${mm}:00${EVENT_TIMEZONE_OFFSET}`);
}

export function parseLeekDate(text, now = new Date()) {
  const match = clean(text).match(DATE_PATTERN);
  if (!match) return null;

  const monthIndex = MONTHS.get(match[1].slice(0, 3).toLowerCase());
  if (monthIndex === undefined) return null;

  const day = Number(match[2]);
  let hour = Number(match[3]);
  const minute = Number(match[4]);
  if (hour === 12) hour = 0;
  if (match[5].toUpperCase() === "PM") hour += 12;

  let candidate = localEventDate(now.getUTCFullYear(), monthIndex, day, hour, minute);
  if (Number.isNaN(candidate.getTime())) return null;

  const halfYearMs = 183 * 86_400_000;
  if (candidate.getTime() - now.getTime() > halfYearMs) {
    candidate = localEventDate(candidate.getUTCFullYear() - 1, monthIndex, day, hour, minute);
  } else if (now.getTime() - candidate.getTime() > halfYearMs) {
    candidate = localEventDate(candidate.getUTCFullYear() + 1, monthIndex, day, hour, minute);
  }
  return candidate;
}

function slugFromUrl(url) {
  return new URL(url).pathname.split("/").filter(Boolean).pop();
}

function readCardText($, anchor) {
  const anchorText = clean($(anchor).text());
  if (DATE_PATTERN.test(anchorText)) return anchorText;

  let node = $(anchor);
  for (let depth = 0; depth < 4; depth += 1) {
    node = node.parent();
    if (!node.length) break;
    const candidate = clean(node.text());
    // Never let the search expand into the full events index; that joins many
    // cards and makes a date belong to the wrong event.
    if (candidate.length > 700) break;
    if (DATE_PATTERN.test(candidate)) return candidate;
  }
  return anchorText;
}

function titleFromAnchor(anchorText, url) {
  const text = clean(anchorText)
    .replace(DATE_PATTERN, "")
    .replace(/(?:Starts|Ends):\s*\d+\s*days?\s*\d+\s*hours?\s*\d+\s*min/gi, "")
    .trim();
  return text || slugFromUrl(url).replace(/[-_]+/g, " ");
}

function collectIndexRows(html, now) {
  const $ = cheerio.load(html);
  const rows = [];

  $("a[href*='/events/']").each((_, anchor) => {
    const href = $(anchor).attr("href");
    if (!href) return;
    const url = new URL(href, LEEKDUCK_EVENTS_URL).href.split("#")[0];
    if (url === LEEKDUCK_EVENTS_URL) return;

    const anchorText = clean($(anchor).text());
    const cardText = readCardText($, anchor);
    const parsedDate = parseLeekDate(cardText, now);

    rows.push({ href, url, anchorText, cardText, parsedDate });
  });
  return rows;
}

export function inspectEventsIndex(html, now = new Date()) {
  const rows = collectIndexRows(html, now);
  return {
    now: now.toISOString(),
    matchingLinkCount: rows.length,
    links: rows.map(row => ({
      href: row.href,
      url: row.url,
      anchorText: row.anchorText.slice(0, 320),
      cardText: row.cardText.slice(0, 700),
      parsedDate: row.parsedDate?.toISOString() || null,
      includedByWindow: false
    }))
  };
}

export function discoverUpcomingEvents(html, now = new Date()) {
  const rows = collectIndexRows(html, now);
  const byUrl = new Map();
  const recentStartBoundary = new Date(now.getTime() - 14 * 86_400_000);
  const horizon = new Date(now.getTime() + HORIZON_DAYS * 86_400_000);

  for (const row of rows) {
    if (byUrl.has(row.url) || !row.parsedDate) continue;
    if (row.parsedDate < recentStartBoundary || row.parsedDate > horizon) continue;

    // Index-card time is only a discovery hint: the detail page later becomes
    // authoritative for start/end dates and Pokémon content.
    byUrl.set(row.url, {
      id: slugFromUrl(row.url),
      url: row.url,
      title: titleFromAnchor(row.anchorText || row.cardText, row.url),
      listedStart: row.parsedDate.toISOString(),
      start: row.parsedDate.toISOString(),
      end: row.parsedDate.toISOString(),
      indexSource: "leekduck-events-index"
    });
  }

  return [...byUrl.values()].sort((a, b) => new Date(a.listedStart) - new Date(b.listedStart));
}
