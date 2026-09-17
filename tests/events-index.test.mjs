import assert from "node:assert/strict";
import { discoverUpcomingEvents, parseLeekDate } from "../scripts/leekduck/events-index.mjs";

const indexHtml = `
  <main>
    <article><a href="/events/ten-year-party/">Event 10th Anniversary Party</a><p>Mon, Jul 6, at 8:00 PM Local Time Ends: 0 days 0 hours 0 min</p></article>
    <article><a href="/events/road-of-legends/">Event Road of Legends</a><p>Fri, Jul 10, at 11:59 PM Local Time Ends: 0 days 0 hours 0 min</p></article>
    <article><a href="/events/future-event/">Event Far Future</a><p>Mon, Aug 31, at 10:00 AM Local Time</p></article>
  </main>
`;

const now = new Date("2026-07-04T12:00:00+08:00");
assert.equal(parseLeekDate("Fri, Jul 3, at 8:00 PM Local Time", now)?.toISOString(), "2026-07-03T12:00:00.000Z");

const events = discoverUpcomingEvents(indexHtml, now);
assert.deepEqual(events.map(event => event.id), ["ten-year-party", "road-of-legends"]);
assert.equal(events[0].listedStart, "2026-07-06T12:00:00.000Z");
assert.equal(events[1].listedStart, "2026-07-10T15:59:00.000Z");
console.log("events-index discovery test passed");
