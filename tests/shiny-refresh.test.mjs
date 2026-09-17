import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeGeneratedEventData } from "../scripts/leekduck/write-output.mjs";

const root = await mkdtemp(path.join(tmpdir(), "pokemon-shiny-refresh-"));
const shinyEvent = {
  id: "shiny-debut",
  name: "Shiny Debut",
  pokemonLegacy: { shinyDebuts: [872, 873] },
  pokemon: []
};

await writeGeneratedEventData({ root, events: [shinyEvent] });
await writeGeneratedEventData({ root, events: [] });

const payload = JSON.parse(await readFile(
  path.join(root, "data", "leekduck-event-data.generated.json"),
  "utf8"
));

assert.deepEqual(payload.shinyAvailableIds, [872, 873]);
console.log("persistent shiny refresh test passed");
