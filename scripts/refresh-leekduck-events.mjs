import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchHtml } from "./leekduck/http.mjs";
import { LEEKDUCK_EVENTS_URL } from "./leekduck/config.mjs";
import { discoverUpcomingEvents, inspectEventsIndex } from "./leekduck/events-index.mjs";
import { auditEventPage } from "./leekduck/audit-page.mjs";
import { parseEventPage } from "./leekduck/parse-event-page.mjs";
import { writeGeneratedEventData } from "./leekduck/write-output.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDirectory = path.join(root, "cache", "leekduck");
const dataDirectory = path.join(root, "data");
const reportDirectory = path.join(root, "reports");
const manifestPath = path.join(dataDirectory, "leekduck-event-manifest.json");
const auditPath = path.join(reportDirectory, "leekduck-event-audit.json");
const indexDebugPath = path.join(reportDirectory, "leekduck-index-discovery-debug.json");
const indexCachePath = path.join(cacheDirectory, "events-index.html");
const auditOnly = process.argv.includes("--audit");

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch { return fallback; }
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function main() {
  await Promise.all([
    mkdir(cacheDirectory, { recursive: true }),
    mkdir(dataDirectory, { recursive: true }),
    mkdir(reportDirectory, { recursive: true })
  ]);

  console.log("Fetching LeekDuck event index…");
  const indexHtml = await fetchHtml(LEEKDUCK_EVENTS_URL);
  await writeFile(indexCachePath, indexHtml, "utf8");
  const indexDebug = inspectEventsIndex(indexHtml);
  await writeFile(indexDebugPath, JSON.stringify(indexDebug, null, 2) + "\n", "utf8");
  const events = discoverUpcomingEvents(indexHtml);
  console.log(`Found ${events.length} active/upcoming events inside the 21-day horizon.`);

  const previousManifest = await readJson(manifestPath, { events: {} });
  const manifest = { source: "LeekDuck", refreshedAt: new Date().toISOString(), events: {} };
  const audits = [];
  const parsedEvents = [];

  for (const event of events) {
    console.log(`• ${event.title}`);
    const html = await fetchHtml(event.url);
    const htmlHash = hash(html);
    const cachePath = path.join(cacheDirectory, `${event.id}.html`);
    await writeFile(cachePath, html, "utf8");

    const parsed = parseEventPage(html, event);
    const eventAudit = auditEventPage(html, event);
    audits.push(eventAudit);

    manifest.events[event.id] = {
      ...event,
      name: parsed.name,
      fetchedAt: new Date().toISOString(),
      htmlHash,
      changedSincePreviousRefresh: previousManifest.events?.[event.id]?.htmlHash !== htmlHash,
      cachePath: path.relative(root, cachePath),
      parseStatus: "success",
      pokemonCount: parsed.pokemon.length,
      warningCount: parsed.warnings.length
    };

    parsedEvents.push(parsed);
  }

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  await writeFile(auditPath, JSON.stringify({ generatedAt: new Date().toISOString(), events: audits }, null, 2) + "\n", "utf8");

  console.log(`Wrote event-index snapshot: ${path.relative(root, indexCachePath)}`);
  console.log(`Wrote discovery debug: ${path.relative(root, indexDebugPath)}`);
  console.log(`Wrote manifest: ${path.relative(root, manifestPath)}`);
  console.log(`Wrote DOM audit: ${path.relative(root, auditPath)}`);

  if (auditOnly) {
    console.log("Audit complete. No generated UI data was written.");
    return;
  }

  const output = await writeGeneratedEventData({ root, events: parsedEvents });
  console.log(`Wrote generated event data: ${path.relative(root, output.jsPath)}`);
  console.log(`Wrote generated JSON: ${path.relative(root, output.jsonPath)}`);
  console.log(`Wrote parser report: ${path.relative(root, output.reportPath)}`);
  console.log("Parser pass complete. The existing UI remains unchanged in this pass.");
}

main().catch((error) => {
  console.error("Event refresh failed:", error.message || error);
  process.exitCode = 1;
});
