import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const speciesFile = fileURLToPath(new URL("../../pokemon-species-local.js", import.meta.url));
const source = readFileSync(speciesFile, "utf8");
const match = source.match(/const\s+localPokemonSpecies\s*=\s*(\[[\s\S]*?\]);/);

if (!match) {
  throw new Error("Could not load the bundled local Pokémon species fallback.");
}

const rows = JSON.parse(match[1]);
const byId = new Map(rows.map((row) => [Number(row.id), row.name]));
const normalizeName = (value) => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();
const byName = new Map(rows.map((row) => [normalizeName(row.name), Number(row.id)]));

/* LeekDuck sometimes publishes a costume-only label with no numeric species
   token in its image filename. Map only the known label to its base Pokédex
   identity so the Event drawer can filter the existing local Pikachu card. */
const specialNameAliases = new Map([
  [normalizeName("Professor Willow's assistant Pikachu"), 25]
]);

export function speciesNameFromId(id) {
  return byId.get(Number(id)) || "";
}

export function speciesIdFromName(name) {
  const normalized = normalizeName(name);
  return byName.get(normalized) ?? specialNameAliases.get(normalized) ?? null;
}
