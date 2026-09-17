import assert from "node:assert/strict";
import { parseEventPage } from "../scripts/leekduck/parse-event-page.mjs";
import { speciesIdFromName } from "../scripts/leekduck/species-fallback.mjs";

const html = `
<div class="page-content">
  <h3>Menu</h3>
  <h1>Example Event</h1>
  <div>Starts: Monday, July 6, 2026, at 6:00 AM Local Time Ends: Tuesday, July 7, 2026, at 10:00 PM Local Time</div>
  <div class="event-description"><ul class="pkmn-list-flex">
    <li class="pkmn-list-item"><div class="pkmn-list-img normal"><img src="https://cdn.leekduck.com/assets/img/pokemon_icons/pokemon_icon_113_00.png"></div><img class="shiny-icon" src="x" alt="shiny"><div class="pkmn-name">Chansey</div></li>
  </ul></div>
  <h2>Spawns</h2>
  <ul class="pkmn-list-flex">
    <li class="pkmn-list-item"><div class="pkmn-list-img water"><img src="https://cdn.leekduck.com/assets/img/pokemon_icons/pm816.icon.png"></div><img class="shiny-icon" src="x" alt="shiny"><div class="pkmn-name">Sobble</div></li>
  </ul>
  <h2>Raids</h2><h4>Five-Star Raids</h4>
  <ul class="pkmn-list-flex">
    <li class="pkmn-list-item"><div class="pkmn-list-img electric"><img src="https://cdn.leekduck.com/assets/img/pokemon_icons/pokemon_icon_145_00.png"></div><img class="shiny-icon" src="x" alt="shiny"><div class="pkmn-name">Zapdos</div></li>
  </ul>
  <h2>Eggs</h2>
  <ul class="pkmn-list-flex">
    <li class="pkmn-list-item"><div class="pkmn-list-img egg10km"><img src="https://cdn.leekduck.com/assets/img/pokemon_icons/pokemon_icon_357_00.png"></div><div class="pkmn-name">Tropius</div></li>
  </ul>
  <h2>Field Research Tasks</h2>
  <ul class="event-field-research-list"><li><div class="reward"><span class="reward-bubble water"><img class="reward-image" src="https://cdn.leekduck.com/assets/img/pokemon_icons_crop/pm816.icon.png"><img class="shiny-icon" src="x" alt="shiny"></span><span class="reward-label"><span>Sobble</span></span></div></li></ul>
  <h2>Waterworks</h2>
  <div class="special-research-list"><div class="page-reward"><span class="page-reward-item"><img class="reward-image" src="https://cdn.leekduck.com/assets/img/pokemon_icons_crop/pm816.icon.png"></span><span>×50</span></div></div>
  <h2>Shiny</h2>
  <ul class="pkmn-list-flex"><li class="pkmn-list-item"><div class="pkmn-list-img water"><img src="https://cdn.leekduck.com/assets/img/pokemon_icons/pm816.s.icon.png"></div><div class="pkmn-name">Sobble</div></li></ul>
</div>`;

const event = { id: "example", title: "Example", url: "https://example.test", start: "2026-07-01T00:00:00.000Z", end: "2026-07-02T00:00:00.000Z" };
const parsed = parseEventPage(html, event);

assert.equal(parsed.name, "Example Event");
assert.equal(parsed.start, "2026-07-05T22:00:00.000Z");
assert.equal(parsed.end, "2026-07-07T14:00:00.000Z");
assert.equal(parsed.pokemon.length, 4);
const sobble = parsed.pokemon.find((pokemon) => pokemon.name === "Sobble");
const zapdos = parsed.pokemon.find((pokemon) => pokemon.name === "Zapdos");
const tropius = parsed.pokemon.find((pokemon) => pokemon.name === "Tropius");
const chansey = parsed.pokemon.find((pokemon) => pokemon.name === "Chansey");
assert.ok(sobble);
assert.ok(zapdos);
assert.ok(tropius);
assert.ok(chansey);
assert.ok(sobble.methods.some((method) => method.type === "wild"));
assert.ok(sobble.methods.some((method) => method.type === "field-research"));
assert.ok(sobble.methods.some((method) => method.type === "shiny-list"));
assert.ok(sobble.methods.some((method) => method.type === "research"));
assert.ok(zapdos.methods.some((method) => method.type === "raid" && method.tier === 5));
assert.ok(tropius.methods.some((method) => method.type === "egg" && method.distanceKm === 10));
assert.ok(chansey.methods.some((method) => method.type === "mention"));
assert.deepEqual(parsed.pokemonLegacy.egg10km, [357]);
assert.ok(parsed.pokemonLegacy.shiny.includes(816));
assert.deepEqual(parsed.pokemonLegacy.shinyDebuts.sort((a, b) => a - b), [113, 145, 816]);
assert.equal(parsed.pokemonLegacy.shinyDebuts.includes(357), false);
assert.equal(parsed.pokemon.find((pokemon) => pokemon.name === "×50"), undefined);
assert.equal(speciesIdFromName("Professor Willow's assistant Pikachu"), 25);

console.log("event-page parser correction test passed");


const raidHourHtml = `
  <div class="page-content">
    <h1>Kyogre Raid Hour</h1>
    <div>Starts: Wednesday, July 15, 2026, at 6:00 PM Local Time Ends: Wednesday, July 15, 2026, at 7:00 PM Local Time</div>
    <div class="event-description">A Raid Hour featuring Kyogre is scheduled from 6 to 7 pm Local Time.</div>
  </div>`;
const raidHour = parseEventPage(raidHourHtml, { id: "raidhour", title: "Kyogre Raid Hour", url: "https://example.test", start: "", end: "" });
assert.equal(raidHour.pokemon.length, 1);
assert.equal(raidHour.pokemon[0].name, "Kyogre");
assert.equal(raidHour.pokemon[0].speciesId, 382);
assert.deepEqual(raidHour.pokemon[0].methods, [{ type: "raid", tier: 5 }]);
assert.equal(raidHour.pokemon[0].shiny.eventConfirmed, false);
assert.ok(raidHour.warnings.some((warning) => /text fallback/i.test(warning)));
console.log("raid-hour text fallback test passed");
