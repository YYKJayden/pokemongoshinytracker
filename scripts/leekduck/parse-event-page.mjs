import * as cheerio from "cheerio";
import { EVENT_TIMEZONE_OFFSET } from "./config.mjs";
import { speciesIdFromName, speciesNameFromId } from "./species-fallback.mjs";

const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
const slug = (value) => clean(value)
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "");

const MONTHS = new Map([
  ["january", 1], ["february", 2], ["march", 3], ["april", 4], ["may", 5], ["june", 6],
  ["july", 7], ["august", 8], ["september", 9], ["october", 10], ["november", 11], ["december", 12]
]);

const DISCARD_HEADINGS = new Set(["menu", "leek duck", "resources", "graphic", "advertisement"]);

function imageSpeciesId(src) {
  const match = String(src || "").match(/(?:pokemon_icon_|pm)(\d{1,4})/i);
  return match ? Number(match[1]) : null;
}

function imageIdentity(src) {
  return String(src || "")
    .split("/")
    .pop()
    .replace(/\.(?:png|webp|jpg|jpeg)$/i, "")
    .replace(/(?:_shiny|\.s)(?=\.|_|$)/gi, "")
    .replace(/_shiny$/i, "");
}

function headingSnapshot(state) {
  return [state.h2, state.h3, state.h4].filter(Boolean).filter((heading) => !DISCARD_HEADINGS.has(heading.toLowerCase()));
}

function hasAncestor($, node, selector) {
  return $(node).closest(selector).length > 0;
}

function eggDistanceFromContext($, node, headings) {
  const classes = [
    $(node).attr("class") || "",
    $(node).find("[class*='egg']").map((_, el) => $(el).attr("class") || "").get().join(" "),
    $(node).closest("[class*='egg']").attr("class") || "",
    headings.join(" ")
  ].join(" ");

  const match = classes.match(/(?:egg\s*|)(2|5|7|10|12)\s*km\s*eggs?|egg\s*(2|5|7|10|12)\s*km|egg(2|5|7|10|12)km/i);
  return Number(match?.[1] || match?.[2] || match?.[3] || 0) || null;
}

function nearestResearchSubtype($, node, headings) {
  const all = headings.join(" ").toLowerCase();
  if (hasAncestor($, node, ".event-field-research-list") || /field research/.test(all)) return "field-research";
  if (/timed research/.test(all)) return "timed-research";
  if (/special research/.test(all)) return "special-research";

  const specialList = $(node).closest(".special-research-list");
  if (specialList.length) {
    const nearby = clean(specialList.prevAll(".special-research-subtitle").first().text()).toLowerCase();
    if (/timed/.test(nearby)) return "timed-research";
    if (/special/.test(nearby)) return "special-research";
    if (/premium/.test(nearby)) return "timed-research";
    return "research";
  }

  if (/research/.test(all)) return "research";
  return null;
}

function localContextText($, node) {
  const contextual = $(node).closest(".event-description, .page-content, .special-research-list").first();
  return clean(contextual.text()).slice(0, 1800).toLowerCase();
}

function methodFromContext($, node, headings) {
  const headingText = headings.join(" ").toLowerCase();
  const localText = localContextText($, node);
  const context = `${headingText} ${localText}`;
  const eggDistanceKm = eggDistanceFromContext($, node, headings);

  if (eggDistanceKm) return { type: "egg", distanceKm: eggDistanceKm };
  if (/\b(egg|hatch)\b/.test(headingText)) return { type: "egg", distanceKm: null };

  const research = nearestResearchSubtype($, node, headings);
  if (research) return { type: research };

  if (/\bmax battles?\b/.test(context) || /\bdynamax\b/.test(context)) return { type: "max-battle" };
  if (/\braid/.test(headingText)) {
    let tier = null;
    if (/mega/.test(headingText)) tier = "mega";
    else if (/five[-\s]?star|5[-\s]?star/.test(headingText)) tier = 5;
    else if (/three[-\s]?star|3[-\s]?star/.test(headingText)) tier = 3;
    else if (/one[-\s]?star|1[-\s]?star/.test(headingText)) tier = 1;
    return { type: "raid", tier };
  }

  if (/\b(photobomb|snapshot surprise)\b/.test(context)) return { type: "photobomb" };
  if (/\bincense\b/.test(headingText)) return { type: "incense" };
  if (/\blure\b/.test(headingText)) return { type: "lure" };
  if (/\b(spawn|spawns|wild|habitat)\b/.test(headingText)) return { type: "wild" };
  if (/\bshiny\b/.test(headingText)) return { type: "shiny-list" };
  if (/\b(debut|featured pok[eé]mon|costumed pok[eé]mon)\b/.test(headingText)) return { type: "debut" };
  if (/\b(featured attack|featured attacks|moves?)\b/.test(headingText)) return { type: "featured-attack" };

  return { type: "mention" };
}

function methodKey(method) {
  return `${method.type}|${method.distanceKm ?? ""}|${method.tier ?? ""}`;
}

function sectionKey(headings) {
  return headings.join(" > ") || "Event description";
}

function cleanNameCandidate(value) {
  return clean(value)
    .replace(/(?:Max|Min)\s*CP\s*\d+/gi, "")
    .replace(/[×x]\s*\d+(?:\s*[+x×]\s*\d+)*/gi, "")
    .replace(/\b(?:POSSIBLE\s+)?REWARDS?\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isUsableName(value) {
  const normalized = cleanNameCandidate(value);
  if (!normalized) return false;
  if (/^[×x]?\s*\d+(?:\.\d+)?$/.test(normalized)) return false;
  if (!/[A-Za-zÀ-ÿ]/.test(normalized)) return false;
  if (/^(?:max|min|cp|reward|rewards)$/i.test(normalized)) return false;
  return true;
}

function firstUsable(values) {
  for (const value of values) {
    const candidate = cleanNameCandidate(value);
    if (isUsableName(candidate)) return candidate;
  }
  return "";
}

function pageRewardName($, $node) {
  const localCandidates = [
    $node.find(".page-reward-label, .page-reward-name, .reward-label, .pkmn-name, [class*='pokemon-name'], [class*='reward-name']").first().text(),
    $node.parent().children(".page-reward-label, .page-reward-name, .reward-label, .pkmn-name, [class*='pokemon-name'], [class*='reward-name']").first().text(),
    $node.siblings(".page-reward-label, .page-reward-name, .reward-label, .pkmn-name, [class*='pokemon-name'], [class*='reward-name']").first().text(),
    $node.attr("aria-label"),
    $node.attr("title")
  ];
  return firstUsable(localCandidates);
}

function makeMention($, node, state, kind) {
  const headings = headingSnapshot(state);
  const $node = $(node);
  const image = $node.is("img") ? $node : $node.find("img[src*='/pokemon_icons']").first();
  const src = image.attr("src") || "";
  if (!src) return null;

  const speciesId = imageSpeciesId(src);
  let name = "";
  if (kind === "list") name = firstUsable([$node.find(".pkmn-name").first().text()]);
  if (kind === "reward") name = firstUsable([$node.find(".reward-label").first().text()]);
  if (kind === "page-reward") name = pageRewardName($, $node);

  if (!name && Number.isFinite(speciesId)) name = speciesNameFromId(speciesId);
  if (!isUsableName(name)) return null;

  const method = methodFromContext($, node, headings);
  const shinyByLocalIcon = $node.find("img.shiny-icon, img[alt='shiny']").length > 0;
  const shinyByImage = /(?:_shiny|\.s\.icon|\bShiny\b)/i.test(src);
  const shinyBySection = method.type === "shiny-list";
  const shinyConfirmed = shinyByLocalIcon || shinyByImage || shinyBySection;

  return {
    key: `${slug(name)}__${speciesId ?? imageIdentity(src)}`,
    name,
    speciesId,
    image: src,
    methods: [method],
    shiny: {
      eventConfirmed: shinyConfirmed,
      evidence: [
        ...(shinyByLocalIcon ? ["local-shiny-icon"] : []),
        ...(shinyByImage ? ["shiny-image"] : []),
        ...(shinyBySection ? ["shiny-section"] : [])
      ]
    },
    mentions: [{
      kind,
      section: sectionKey(headings),
      headings,
      method,
      shinyConfirmed,
      evidence: {
        localShinyIcon: shinyByLocalIcon,
        shinyImage: shinyByImage
      }
    }]
  };
}

function mergeMention(records, mention) {
  const existing = records.get(mention.key);
  if (!existing) {
    records.set(mention.key, mention);
    return;
  }

  const methodKeys = new Set(existing.methods.map(methodKey));
  for (const method of mention.methods) {
    if (!methodKeys.has(methodKey(method))) existing.methods.push(method);
  }

  existing.shiny.eventConfirmed ||= mention.shiny.eventConfirmed;
  for (const evidence of mention.shiny.evidence) {
    if (!existing.shiny.evidence.includes(evidence)) existing.shiny.evidence.push(evidence);
  }

  existing.mentions.push(...mention.mentions);
}

function raidHourFallback(eventName) {
  const match = clean(eventName).match(/^(.+?)\s+Raid\s+Hour$/i);
  if (!match) return null;

  const name = clean(match[1]);
  const speciesId = speciesIdFromName(name);
  if (!name || !Number.isFinite(speciesId)) return null;

  return {
    key: `${slug(name)}__${speciesId}`,
    name,
    speciesId,
    image: "",
    methods: [{ type: "raid", tier: 5 }],
    shiny: {
      eventConfirmed: false,
      evidence: []
    },
    mentions: [{
      kind: "text-fallback",
      section: "Event description",
      headings: [],
      method: { type: "raid", tier: 5 },
      shinyConfirmed: false,
      evidence: {
        localShinyIcon: false,
        shinyImage: false
      }
    }]
  };
}

function derivedBuckets(pokemon) {
  const list = pokemon || [];
  const ids = (methodType, predicate = () => true) => list
    .filter((entry) => entry.methods.some((method) => method.type === methodType && predicate(method)))
    .map((entry) => entry.speciesId)
    .filter(Number.isFinite);

  const unique = (values) => [...new Set(values)];

  const shinyAvailable = unique(list
    .filter((entry) => entry.shiny.eventConfirmed)
    .map((entry) => entry.speciesId)
    .filter(Number.isFinite));

  return {
    roster: unique(list.map((entry) => entry.speciesId).filter(Number.isFinite)),
    wild: unique(ids("wild")),
    raid: unique(ids("raid")),
    maxBattle: unique(ids("max-battle")),
    egg: unique(ids("egg")),
    egg2km: unique(ids("egg", (method) => method.distanceKm === 2)),
    egg5km: unique(ids("egg", (method) => method.distanceKm === 5)),
    egg7km: unique(ids("egg", (method) => method.distanceKm === 7)),
    egg10km: unique(ids("egg", (method) => method.distanceKm === 10)),
    egg12km: unique(ids("egg", (method) => method.distanceKm === 12)),
    research: unique(list.filter((entry) => entry.methods.some((method) => /research$/.test(method.type))).map((entry) => entry.speciesId).filter(Number.isFinite)),
    shiny: shinyAvailable,

    /*
      This compatibility field feeds the shiny tracker. Leek Duck marks shiny
      availability with a shiny icon/image or by listing the Pokemon in a
      Shiny section. The tracker only applies these IDs to records that are
      currently locked, so already-available Pokemon are unaffected.
    */
    shinyDebuts: shinyAvailable
  };
}

function parseDetailDate(text) {
  const pattern = /(?:Starts|Ends):\s*(?:[A-Za-z]+,\s*)?([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4}),\s+at\s+(\d{1,2}):(\d{2})\s*([AP]M)\s*(?:Local Time)?/ig;
  const result = {};
  let match;

  while ((match = pattern.exec(text))) {
    const label = match[0].startsWith("Starts") ? "start" : "end";
    const month = MONTHS.get(match[1].toLowerCase());
    if (!month) continue;
    let hour = Number(match[4]);
    if (hour === 12) hour = 0;
    if (match[6].toUpperCase() === "PM") hour += 12;
    const iso = `${match[3]}-${String(month).padStart(2, "0")}-${String(match[2]).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${match[5]}:00${EVENT_TIMEZONE_OFFSET}`;
    const parsed = new Date(iso);
    if (!Number.isNaN(parsed.getTime())) result[label] = parsed.toISOString();
  }

  return result;
}

export function parseEventPage(html, event) {
  const $ = cheerio.load(html);
  const state = { h2: "", h3: "", h4: "" };
  const records = new Map();
  const warnings = [];
  const content = $(".page-content").first();
  const root = content.length ? content : $("body");

  root.find("h1,h2,h3,h4,li.pkmn-list-item,div.reward,div.page-reward").each((_, element) => {
    const tag = element.tagName?.toLowerCase();
    if (tag === "h1") {
      state.h2 = "";
      state.h3 = "";
      state.h4 = "";
      return;
    }
    if (tag === "h2") {
      state.h2 = clean($(element).text());
      state.h3 = "";
      state.h4 = "";
      return;
    }
    if (tag === "h3") {
      state.h3 = clean($(element).text());
      state.h4 = "";
      return;
    }
    if (tag === "h4") {
      state.h4 = clean($(element).text());
      return;
    }

    const $element = $(element);
    let kind = null;
    if ($element.is("li.pkmn-list-item")) kind = "list";
    else if ($element.is("div.reward") && $element.find("img.reward-image[src*='/pokemon_icons']").length) kind = "reward";
    else if ($element.is("div.page-reward") && $element.find("img.reward-image[src*='/pokemon_icons']").length) kind = "page-reward";
    if (!kind) return;

    const mention = makeMention($, element, state, kind);
    if (mention) mergeMention(records, mention);
    else warnings.push(`Could not resolve a Pokémon name in ${kind} under ${sectionKey(headingSnapshot(state))}.`);
  });

  if (records.size === 0) {
    const fallback = raidHourFallback(clean($("h1").first().text()) || event.title);
    if (fallback) {
      records.set(fallback.key, fallback);
      warnings.push(`Used text fallback for ${fallback.name} Raid Hour; LeekDuck page has no Pokémon card.`);
    }
  }

  const pokemon = [...records.values()].sort((a, b) => a.name.localeCompare(b.name));
  const derived = derivedBuckets(pokemon);
  const timing = parseDetailDate(clean(root.text()));

  return {
    id: event.id,
    name: clean($("h1").first().text()) || event.title,
    url: event.url,
    start: timing.start || event.start,
    end: timing.end || event.end,
    listedStart: event.listedStart,
    category: event.category || "Event",
    pokemon,
    pokemonLegacy: derived,
    warnings: [...new Set(warnings)]
  };
}
