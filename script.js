const pokemonList = document.getElementById("pokemonList");


const cursorPokemonName = document.createElement("div");
cursorPokemonName.className = "cursor-pokemon-name";
cursorPokemonName.setAttribute("aria-hidden", "true");
document.body.appendChild(cursorPokemonName);

function showCursorPokemonName(label, clientX, clientY) {
  if (!label) return;

  cursorPokemonName.textContent = label;
  moveCursorPokemonName(clientX, clientY);
  cursorPokemonName.classList.add("visible");
}

function moveCursorPokemonName(clientX, clientY) {
  const gapX = 12;
  const gapY = 14;
  const tooltipWidth = cursorPokemonName.offsetWidth || 120;
  const tooltipHeight = cursorPokemonName.offsetHeight || 30;

  let left = clientX + gapX;
  let top = clientY + gapY;

  if (left + tooltipWidth > window.innerWidth - 8) {
    left = clientX - tooltipWidth - gapX;
  }

  if (top + tooltipHeight > window.innerHeight - 8) {
    top = clientY - tooltipHeight - gapY;
  }

  cursorPokemonName.style.left = Math.max(8, left) + "px";
  cursorPokemonName.style.top = Math.max(8, top) + "px";
}

function hideCursorPokemonName() {
  cursorPokemonName.classList.remove("visible");
}

/*
  Delegated cursor tracking is the single durable hover path. Cards are
  recreated during search/filter/event changes; listening on pokemonList means
  the label remains reliable even while the grid rerenders.
*/
let activeCursorPokemonCard = null;

function getCursorPokemonCard(target) {
  return target && target.closest
    ? target.closest(".pokemon-card[data-pokemon-label]")
    : null;
}

pokemonList.addEventListener("pointerover", function (event) {
  if (event.pointerType === "touch") return;

  const card = getCursorPokemonCard(event.target);
  if (!card || card === activeCursorPokemonCard) return;

  activeCursorPokemonCard = card;
  showCursorPokemonName(card.dataset.pokemonLabel, event.clientX, event.clientY);
});

pokemonList.addEventListener("pointermove", function (event) {
  if (event.pointerType === "touch") return;

  const card = getCursorPokemonCard(event.target);
  if (!card) return;

  if (card !== activeCursorPokemonCard) {
    activeCursorPokemonCard = card;
    showCursorPokemonName(card.dataset.pokemonLabel, event.clientX, event.clientY);
    return;
  }

  moveCursorPokemonName(event.clientX, event.clientY);
});

pokemonList.addEventListener("pointerout", function (event) {
  const leaving = getCursorPokemonCard(event.target);
  const entering = getCursorPokemonCard(event.relatedTarget);

  if (leaving && leaving !== entering) {
    activeCursorPokemonCard = null;
    hideCursorPokemonName();
  }
});


// ----------------------
// STATE
// ----------------------

let shinyMap = loadShinyData();
let pokemonData = [];

let searchQuery = "";
let showMetaOnly = false; // Event engine intentionally removed.
let showMissingOnly = false;
let compactView = true;

let leekEventsOpen = false;
let leekEventsLoading = false;
let leekEventsLoaded = false;
let leekEventsError = "";
let leekEvents = [];
let leekEventManifest = null;
let selectedLeekEventUrl = "";
let leekEventResizeObserver = null;
let leekEventSelectionDotRaf = 0;

let ultraGridView = localStorage.getItem("ultraGridView") === "true";
const showDexNumberBadges = true;

/*
  When UNREGISTERED is active:
  - Newly checked Pokémon should stay visible temporarily.
  - This prevents one wrong tap from making the card disappear immediately.
  - The temporary list resets when user refreshes or clicks UNREGISTERED again.
*/
let missingSessionPinnedIds = new Set();

const regionRanges = [
  { name: "Kanto", start: 1, end: 151 },
  { name: "Johto", start: 152, end: 251 },
  { name: "Hoenn", start: 252, end: 386 },
  { name: "Sinnoh", start: 387, end: 493 },
  { name: "Unova", start: 494, end: 649 },
  { name: "Kalos", start: 650, end: 721 },
  { name: "Alola", start: 722, end: 809 },
  { name: "Galar", start: 810, end: 898 },
  { name: "Hisui", start: 899, end: 905 },
  { name: "Paldea", start: 906, end: 1025 }
];

// ----------------------
// EVENTS
// Filled automatically by event-importer.js
// ----------------------

let regionCompletionResizeObserver = null;
let regionCompletionOpen = false;

// ----------------------
// EVENT COMPATIBILITY HOOKS — INERT
// ----------------------
/*
  The normal Pokédex renderer has always called these hooks for optional
  event filtering/badges/countdowns. Events are removed in this baseline, so
  they return inert values rather than running any event logic.
*/
function getMetaSet() {
  return showMetaOnly ? getLeekMetaSet() : new Set();
}

function getMetaType(id) {
  return showMetaOnly ? getLeekMetaType(id) : null;
}

function getEventCountdownText() {
  return "";
}

// ----------------------
// LEEK DUCK EVENT PANEL
// ----------------------

async function refreshLeekDuckEvents() {
  if (leekEventsLoading) return;

  leekEventsLoading = true;
  leekEventsError = "";
  renderLeekEventPanel();

  try {
    if (typeof loadLeekDuckEvents !== "function") {
      throw new Error("leekduck-events.js did not load.");
    }

    const payload = await loadLeekDuckEvents();
    leekEventManifest = payload.manifest || null;
    window.__leekDuckEventManifest = leekEventManifest;
    leekEvents = Array.isArray(payload.events) ? payload.events : [];
    selectedLeekEventUrl = "";
    leekEventsLoaded = true;

    /*
      Apply the shiny-availability signals generated by refresh:events. This
      updates the loaded tracker records without rewriting pokemon-data.js.
    */
    applyLeekDuckShinyAvailability(leekEvents, payload.shinyAvailableIds);
    updateProgress();
    rerenderList();
  } catch (error) {
    leekEventsError = error && error.message ? error.message : String(error);
    leekEvents = [];
    leekEventsLoaded = false;
    console.error("Leek Duck event load failed:", error);
  } finally {
    leekEventsLoading = false;
    renderLeekEventPanel();
  }
}

function getSelectedLeekEvent() {
  return leekEvents.find(function (event) {
    return event.url === selectedLeekEventUrl;
  }) || null;
}

function getLeekEventPokemonIds(event) {
  return event && event.pokemon && Array.isArray(event.pokemon.roster)
    ? event.pokemon.roster
    : [];
}

function applyLeekDuckShinyAvailability(events, persistentIds) {
  const debutIds = new Set((persistentIds || []).map(Number).filter(Number.isFinite));

  (events || []).forEach(function (event) {
    const ids = event && event.pokemon && event.pokemon.shinyDebuts;
    (ids || []).forEach(function (id) {
      debutIds.add(Number(id));
    });
  });

  if (!debutIds.size) return;

  pokemonData.forEach(function (pokemon) {
    if (!debutIds.has(pokemon.id)) return;

    /*
      A qualifying Leek Duck shiny signal removes the mutable source override
      and promotes the loaded tracker record to available.
    */
    if (typeof availabilityOverrides !== "undefined") {
      delete availabilityOverrides[pokemon.id];
    }

    pokemon.availability = "available";
  });
}

function getLeekMetaSet() {
  const selected = getSelectedLeekEvent();
  return new Set(getLeekEventPokemonIds(selected));
}

function isSelectedLeekMegaRaidPokemon(event, id) {
  const numericId = Number(id);
  const details = event && Array.isArray(event.pokemonDetails)
    ? event.pokemonDetails
    : [];

  /*
    The main Pokédex uses base species IDs, while LeekDuck keeps Mega forms as
    separate event entries. A selected Mega Raid therefore upgrades the base
    Pokémon card's normal RAID source marker to MEGA.
  */
  const eventTitle = String(event && event.title || "");

  /*
    Only dedicated Mega Raid pages may infer Mega status from the title.
    Mixed events such as "Pokemon GO Fest 2026: Mega Finale" contain the word
    Mega but also list wild, research, and ordinary raid Pokemon.
  */
  const isDedicatedMegaRaidEvent =
    /\bin\s+mega\s+raids?\b/i.test(eventTitle) ||
    /\b(?:super\s+)?mega\s+raid\s+day\b/i.test(eventTitle);

  return details.some(function (entry) {
    const entryId = Number(entry && entry.speciesId);
    const entryName = String(entry && (entry.name || entry.key) || "");
    const methods = Array.isArray(entry && entry.methods) ? entry.methods : [];

    const isRaidEntry = methods.some(function (method) {
      return method && method.type === "raid";
    });
    const entryIsMegaRaid = /\bmega\b/i.test(entryName) && isRaidEntry;

    return entryId === numericId &&
      (entryIsMegaRaid || (isDedicatedMegaRaidEvent && isRaidEntry));
  });
}

function getLeekMetaType(id) {
  const selected = getSelectedLeekEvent();
  const data = selected && selected.pokemon;
  const numericId = Number(id);

  if (!data) return null;
  if (isSelectedLeekMegaRaidPokemon(selected, numericId)) return "mega";
  if ((data.wild || []).includes(numericId)) return "wild";
  if ((data.lure || []).includes(numericId)) return "lure";
  if ((data.egg2km || []).includes(numericId)) return "2km";
  if ((data.egg5km || []).includes(numericId)) return "5km";
  if ((data.egg7km || []).includes(numericId)) return "7km";
  if ((data.egg10km || []).includes(numericId)) return "10km";
  if ((data.egg12km || []).includes(numericId)) return "12km";
  if ((data.egg || []).includes(numericId)) return "hatch";
  if ((data.raid || []).includes(numericId)) return "raid";
  if ((data.maxBattle || []).includes(numericId)) return "max";
  if ((data.research || []).includes(numericId)) return "research";
  return null;
}

function initLeekEventResizeObserver() {
  const panel = document.getElementById("leekEventPanel");
  const measure = document.getElementById("leekEventMeasure");
  const measureContent = document.getElementById("leekEventMeasureContent");

  if (!panel || !measure || !measureContent) return;

  panel.hidden = true;
  panel.classList.remove("open");

  /*
    The drawer itself is never measured while collapsed. Instead, this invisible
    sibling uses the same final header + fixed event-card + track geometry at
    its natural height. It is the source of truth for the open drawer target.
  */
  if (typeof ResizeObserver !== "undefined") {
    if (leekEventResizeObserver) {
      leekEventResizeObserver.disconnect();
    }

    leekEventResizeObserver = new ResizeObserver(function () {
      syncLeekEventPanelHeight();
    });

    leekEventResizeObserver.observe(measureContent);
  }

  syncLeekEventPanelHeight();
}

function syncLeekEventPanelHeight() {
  const panel = document.getElementById("leekEventPanel");
  const measureContent = document.getElementById("leekEventMeasureContent");

  if (!panel || !measureContent) return;

  /*
    getBoundingClientRect() reads the actual rendered final-card geometry,
    including the horizontal track / scrollbar footprint that was previously
    undercounted in the collapsed drawer.
  */
  const target = Math.ceil(measureContent.getBoundingClientRect().height);

  panel.style.setProperty(
    "--leek-event-content-height",
    Math.max(target, 1) + "px"
  );
}

function scheduleLeekEventPanelHeightSync() {
  window.requestAnimationFrame(function () {
    syncLeekEventPanelHeight();
  });
}

function setLeekEventsOpen(isOpen) {
  const button = document.getElementById("leekEventsBtn");
  const panel = document.getElementById("leekEventPanel");

  if (!button || !panel) return;

  leekEventsOpen = !!isOpen;
  button.classList.toggle("active", leekEventsOpen);
  button.setAttribute("aria-expanded", leekEventsOpen ? "true" : "false");

  if (leekEventsOpen) {
    selectedLeekEventUrl = "";
    showMetaOnly = false;
    rerenderList();
    renderLeekEventPanel();

    panel.hidden = false;
    panel.classList.remove("open");
    syncLeekEventPanelHeight();
    void panel.offsetHeight;

    window.requestAnimationFrame(function () {
      panel.classList.add("open");
    });

    if (!leekEventsLoaded && !leekEventsLoading) {
      refreshLeekDuckEvents();
    }
    return;
  }

  panel.classList.remove("open");

  window.setTimeout(function () {
    if (!panel.classList.contains("open")) {
      panel.hidden = true;
    }
  }, 320);
}


function getLeekEventSelectionDot() {
  const content = document.getElementById("leekEventPanelContent");
  if (!content) return null;

  let dot = content.querySelector(".leek-event-selection-dot");

  if (!dot) {
    dot = document.createElement("span");
    dot.className = "leek-event-selection-dot";
    dot.setAttribute("aria-hidden", "true");
    content.appendChild(dot);
  }

  return dot;
}

function hideLeekEventSelectionDot() {
  const content = document.getElementById("leekEventPanelContent");
  const dot = content && content.querySelector(".leek-event-selection-dot");

  if (dot) {
    dot.classList.remove("is-visible");
  }
}

function syncLeekEventSelectionDot(animate) {
  const content = document.getElementById("leekEventPanelContent");
  const track = document.getElementById("leekEventTrack");

  if (!content || !track) return;

  const selectedCard = track.querySelector(".leek-event-card.selected");

  if (!selectedCard) {
    hideLeekEventSelectionDot();
    return;
  }

  const dot = getLeekEventSelectionDot();

  if (!dot) return;

  const contentRect = content.getBoundingClientRect();
  const cardRect = selectedCard.getBoundingClientRect();

  /*
    Horizontal center remains on the card's right outline.
    Vertical position mirrors the current preferred top: 4px placement.
  */
  const x = Math.round(cardRect.right - contentRect.left - 4);
  const y = Math.round(cardRect.top - contentRect.top + 4);

  const shouldAnimate = !!animate && dot.classList.contains("is-visible");

  dot.classList.toggle("is-instant", !shouldAnimate);
  dot.style.transform = "translate3d(" + x + "px, " + y + "px, 0)";
  dot.classList.add("is-visible");

  if (!shouldAnimate) {
    window.requestAnimationFrame(function () {
      dot.classList.remove("is-instant");
    });
  }
}

function scheduleLeekEventSelectionDot(animate) {
  window.cancelAnimationFrame(leekEventSelectionDotRaf);

  leekEventSelectionDotRaf = window.requestAnimationFrame(function () {
    syncLeekEventSelectionDot(animate);
  });
}

function bindLeekEventSelectionDotTracking(track) {
  if (!track || track.dataset.leekSelectionDotBound === "true") return;

  track.dataset.leekSelectionDotBound = "true";

  track.addEventListener("scroll", function () {
    scheduleLeekEventSelectionDot(false);
  }, { passive: true });
}

function renderLeekEventPanel() {
  const track = document.getElementById("leekEventTrack");
  const meta = document.getElementById("leekEventPanelMeta");

  if (!track || !meta) return;

  bindLeekEventSelectionDotTracking(track);
  track.innerHTML = "";

  /*
    Loading uses cards with the exact same geometry as completed cards. This is
    visual stability only in v14; it does not control panel height because the
    outer panel remains in natural document flow.
  */
  if (leekEventsLoading || !leekEventsLoaded) {
    meta.textContent = "Preparing Leek Duck events…";
    appendLeekEventSkeletons(track, 4);
    hideLeekEventSelectionDot();
    scheduleLeekEventPanelHeightSync();
    return;
  }

  if (leekEventsError) {
    meta.textContent = "Leek Duck could not be read.";
    track.appendChild(createLeekEventMessage(
      "Event refresh failed: " + leekEventsError
    ));
    hideLeekEventSelectionDot();
    scheduleLeekEventPanelHeightSync();
    return;
  }

  const selectedEvent = getSelectedLeekEvent();
  const selectedCount = getLeekEventPokemonIds(selectedEvent).length;

  meta.textContent = leekEvents.length
    ? leekEvents.length + " events" +
      (selectedEvent ? " · Showing " + selectedCount + " Pokémon" : "")
    : "No included events.";

  if (!leekEvents.length) {
    track.appendChild(createLeekEventMessage("No included events."));
    hideLeekEventSelectionDot();
    scheduleLeekEventPanelHeightSync();
    return;
  }

  leekEvents.forEach(function (event) {
    const card = document.createElement("button");
    const selected = event.url === selectedLeekEventUrl;

    card.type = "button";
    const eventStatus = getLeekEventStatus(event).toLowerCase();
    card.className = "leek-event-card " + eventStatus + (selected ? " selected" : "");
    card.setAttribute("aria-pressed", selected ? "true" : "false");

    const title = document.createElement("strong");
    title.className = "leek-event-title";
    title.textContent = event.title;

    card.appendChild(title);
    card.appendChild(createLeekEventTimeBlock(event.start, event.end));

    card.addEventListener("click", function () {
      selectedLeekEventUrl = event.url;
      showMetaOnly = true;
      rerenderList();
      renderLeekEventPanel();
    });

    track.appendChild(card);
  });

  scheduleLeekEventSelectionDot(true);
  scheduleLeekEventPanelHeightSync();
}

/*
  The event drawer intentionally renders no second Pokémon roster. Selecting an
  active event filters the canonical Pokédex grid below, which remains the one
  visual source of truth for card state, sprites, and interactions.
*/

function formatLeekMethodLabel(method) {
  const type = method && method.type;
  if (type === "wild") return "Wild encounters";
  if (type === "raid") return method.tier ? method.tier + "-star raids" : "Raids";
  if (type === "max-battle") return "Max Battles";
  if (type === "egg") return (method.distanceKm || "?") + " km Eggs";
  if (type === "field-research") return "Field Research";
  if (type === "special-research") return "Special Research";
  if (type === "timed-research") return "Timed Research";
  if (type === "photobomb") return "Photobomb";
  if (type === "incense") return "Incense";
  if (type === "debut") return "Pokémon debut";
  if (type === "featured-attack") return "Featured attacks";
  if (type === "shiny-list") return "Shiny availability";
  return "Other event mentions";
}

function appendLeekEventSkeletons(track, count) {
  for (let index = 0; index < count; index += 1) {
    const card = document.createElement("div");
    card.className = "leek-event-card leek-event-skeleton";
    card.setAttribute("aria-hidden", "true");

    const top = document.createElement("div");
    top.className = "leek-event-card-top";
    top.innerHTML =
      '<span class="leek-skeleton-pill"></span>' +
      '<span class="leek-skeleton-status"></span>';

    const title = document.createElement("span");
    title.className = "leek-skeleton-title";
    title.innerHTML = "<i></i><i></i><i></i>";

    const time = document.createElement("span");
    time.className = "leek-skeleton-time";
    time.innerHTML = "<i></i><i></i>";

    card.appendChild(top);
    card.appendChild(title);
    card.appendChild(time);
    track.appendChild(card);
  }
}

function createLeekEventMessage(message) {
  const item = document.createElement("p");
  item.className = "leek-event-message";
  item.textContent = message;
  return item;
}

function getLeekEventStatus(event) {
  const now = Date.now();
  const start = new Date(event.start).getTime();
  const end = new Date(event.end).getTime();

  if (start <= now && now <= end) return "LIVE";
  if (now < start) return "UPCOMING";
  return "ENDED";
}

function createLeekEventTimeBlock(startValue, endValue) {
  const block = document.createElement("span");
  block.className = "leek-event-time";

  const start = new Date(startValue);
  const end = new Date(endValue);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    block.textContent = "Exact time unavailable";
    return block;
  }

  const formatter = new Intl.DateTimeFormat("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });

  const startLine = document.createElement("span");
  startLine.className = "leek-event-time-line";
  startLine.textContent = "Starts · " + formatter.format(start);

  const endLine = document.createElement("span");
  endLine.className = "leek-event-time-line";
  endLine.textContent = "Ends · " + formatter.format(end);

  block.appendChild(startLine);
  block.appendChild(endLine);
  return block;
}

// ----------------------
// STORAGE
// ----------------------

function saveShinyData() {
  localStorage.setItem("shinyTracker", JSON.stringify(shinyMap));
}

function loadShinyData() {
  const saved = localStorage.getItem("shinyTracker");

  if (saved) {
    return JSON.parse(saved);
  }

  return {};
}

// ----------------------
// EXPORT / IMPORT
// ----------------------

function exportSaveData() {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    shinyMap: shinyMap
  };

  const jsonString = JSON.stringify(payload, null, 2);
  const blob = new Blob([jsonString], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = "pokemon-shiny-tracker-save.json";
  link.click();

  URL.revokeObjectURL(url);
}

function applyImportedSave(parsedData) {
  if (!parsedData || typeof parsedData !== "object") {
    throw new Error("Invalid save data.");
  }

  const importedShinyMap =
    parsedData.shinyMap && typeof parsedData.shinyMap === "object"
      ? parsedData.shinyMap
      : parsedData;

  shinyMap = importedShinyMap;

  // Imported save changes the real data, so reset temporary UNREGISTERED session.
  missingSessionPinnedIds.clear();

  saveShinyData();
  updateProgress();
  rerenderList();
}

function importSaveFile(file) {
  const reader = new FileReader();

  reader.onload = function (event) {
    try {
      const parsedData = JSON.parse(event.target.result);
      applyImportedSave(parsedData);
      alert("Save imported successfully.");
    } catch (error) {
      console.error(error);
      alert("Import failed. Please use a valid save file.");
    }
  };

  reader.readAsText(file);
}

// ----------------------
// HELPERS
// ----------------------

function getStatusText(pokemon, isShiny) {
  if (pokemon.availability === "not-released") {
    return "Not Released";
  }

  if (pokemon.availability === "shiny-locked") {
    return "Shiny Locked";
  }

  return isShiny ? "Shiny Caught" : "Not shiny";
}

function getSpriteUrl(id, isShiny) {
  if (isShiny) {
    return "sprites/shiny/" + id + ".png";
  } else {
    return "sprites/normal/" + id + ".png";
  }
}

function formatPokemonName(name) {
  const parts = name.split("-");

  for (let i = 0; i < parts.length; i++) {
    parts[i] = parts[i].charAt(0).toUpperCase() + parts[i].slice(1);
  }

  return parts.join(" ");
}

function getProgressTier(percent) {
  if (percent <= 20) {
    return {
      label: "A CASUAL COLLECTOR",
      color: "#fca5a5",
      className: "tier-casual"
    };
  }

  if (percent <= 40) {
    return {
      label: "GETTING THERE!",
      color: "#fb923c",
      className: "tier-getting"
    };
  }

  if (percent <= 60) {
    return {
      label: "RESPECTABLE",
      color: "#facc15",
      className: "tier-respectable"
    };
  }

  if (percent <= 85) {
    return {
      label: "A TRUE SHINY COLLECTOR",
      color: "#86efac",
      className: "tier-true"
    };
  }

  return {
    label: "A COMPLETIONIST",
    color: "#22c55e",
    className: "tier-completionist"
  };
}

// ----------------------
// FETCH DATA
// ----------------------

async function loadPokemonData() {
  /*
    Local-first boot:
    The tracker no longer depends on pokeapi.co just to render the Pokédex.
    A bundled 1–1025 species list is always present in the folder.

    We retain an optional short PokeAPI refresh attempt only when the local
    list is missing/corrupt. Event importing is independent and may still
    fail gracefully without preventing the Pokédex from loading.
  */
  let species = [];

  if (
    typeof localPokemonSpecies !== "undefined" &&
    Array.isArray(localPokemonSpecies) &&
    localPokemonSpecies.length >= 1025
  ) {
    species = localPokemonSpecies.map(function (pokemon) {
      return {
        id: Number(pokemon.id),
        name: String(pokemon.name || "")
      };
    });
  } else {
    species = await fetchPokemonSpeciesFromPokeApi();
  }

  const overrides =
    typeof availabilityOverrides !== "undefined" ? availabilityOverrides : {};

  pokemonData = species
    .filter(function (pokemon) {
      return Number.isFinite(pokemon.id) && pokemon.id >= 1 && pokemon.id <= 1025;
    })
    .map(function (pokemon) {
      return {
        id: pokemon.id,
        name: formatPokemonName(pokemon.name),
        availability: overrides[pokemon.id] || "available"
      };
    });

  if (pokemonData.length < 1025) {
    throw new Error("Bundled Pokémon species list is incomplete.");
  }

  pokemonData.sort(function (a, b) {
    return a.id - b.id;
  });

  /*
    Event importer bridge:
    Fandom encounter cards sometimes expose a Pokémon as a linked name/image
    instead of visible "#Dex" text. Keep a normalized species lookup ready
    after the app's own Pokédex has loaded.
  */
  window.__pokemonToolsetPokemonNameToId = {};

  pokemonData.forEach(function (pokemon) {
    const key = normalizePokemonLookupKey(pokemon.name);
    if (key) {
      window.__pokemonToolsetPokemonNameToId[key] = pokemon.id;
    }
  });
}

async function fetchPokemonSpeciesFromPokeApi() {
  const controller = new AbortController();
  const timeout = window.setTimeout(function () {
    controller.abort();
  }, 8000);

  try {
    const response = await fetch(
      "https://pokeapi.co/api/v2/pokemon-species?limit=1025&offset=0",
      { signal: controller.signal }
    );

    if (!response.ok) {
      throw new Error("PokeAPI returned HTTP " + response.status);
    }

    const data = await response.json();

    return (data.results || []).map(function (pokemon) {
      const parts = String(pokemon.url || "").split("/").filter(Boolean);
      return {
        id: Number(parts[parts.length - 1]),
        name: pokemon.name
      };
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

function normalizePokemonLookupKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’:.\-\s]/g, "")
    .replace(/[♀]/g, "f")
    .replace(/[♂]/g, "m")
    .replace(/[^a-z0-9]/g, "");
}

// ----------------------
// FILTERS
// ----------------------

function getFilteredPokemon() {
  const metaSet = getMetaSet();

  return pokemonData.filter(function (pokemon) {
    const isAvailable = pokemon.availability === "available";
    const isShiny = !!shinyMap[pokemon.id];

    const matchesSearch =
      pokemon.name.toLowerCase().includes(searchQuery) ||
      String(pokemon.id).includes(searchQuery);

    const matchesMeta = !showMetaOnly || metaSet.has(pokemon.id);

    /*
      UNREGISTERED behavior:
      - Normally show available + not shiny.
      - Also keep newly checked shiny Pokémon visible during this UNREGISTERED session.
      - This temporary pinned list disappears on refresh or when UNREGISTERED is clicked again.
    */
    const isPinnedInMissingSession = missingSessionPinnedIds.has(pokemon.id);

    const matchesMissing =
      !showMissingOnly ||
      (isAvailable && (!isShiny || isPinnedInMissingSession));

    return matchesSearch && matchesMeta && matchesMissing;
  });
}

// ----------------------
// PROGRESS
// ----------------------

function updateProgress() {
  const total = pokemonData.filter(function (pokemon) {
    return pokemon.availability === "available";
  }).length;

  let shinyCount = 0;

  pokemonData.forEach(function (pokemon) {
    if (
      pokemon.availability === "available" &&
      shinyMap[pokemon.id]
    ) {
      shinyCount++;
    }
  });

  const progressText = document.getElementById("progressText");
  const progressBarFill = document.getElementById("progressBarFill");
  const progressRank = document.getElementById("progressRank");

  progressText.textContent = "Shiny: " + shinyCount + " / " + total;

  const percent = total > 0 ? (shinyCount / total) * 100 : 0;
  const tier = getProgressTier(percent);

  progressBarFill.style.width = percent + "%";
  progressBarFill.style.backgroundColor = tier.color;
  progressRank.textContent = tier.label;
  progressRank.style.color = tier.color;

  updateRegionProgress();
}
function updateRegionProgress() {
  const regionProgressGrid = document.getElementById("regionProgressGrid");

  if (!regionProgressGrid) return;

  regionProgressGrid.innerHTML = "";

  regionRanges.forEach(function (region) {
    const regionPokemon = pokemonData.filter(function (pokemon) {
      return (
        pokemon.id >= region.start &&
        pokemon.id <= region.end &&
        pokemon.availability === "available"
      );
    });

    const total = regionPokemon.length;

    let shinyCount = 0;

    regionPokemon.forEach(function (pokemon) {
      if (shinyMap[pokemon.id]) {
        shinyCount++;
      }
    });

    const percent = total > 0 ? Math.round((shinyCount / total) * 100) : 0;
    const tier = getProgressTier(percent);

    const card = document.createElement("button");
    card.className = "region-card " + tier.className;
    card.type = "button";
    card.dataset.regionStart = region.start;
    card.setAttribute("aria-label", "Jump to " + region.name + " region");

    const name = document.createElement("p");
    name.className = "region-name";
    name.textContent = region.name;

    const count = document.createElement("p");
    count.className = "region-count";
    count.textContent = shinyCount + " / " + total;

    const percentText = document.createElement("p");
    percentText.className = "region-percent";
    percentText.textContent = percent + "%";

    card.appendChild(name);
    card.appendChild(count);
    card.appendChild(percentText);

    card.addEventListener("click", function () {
      jumpToRegion(region);
    });

    regionProgressGrid.appendChild(card);
  });

  window.requestAnimationFrame(syncRegionCompletionHeight);
}

function jumpToRegion(region) {
  searchQuery = "";
  showMetaOnly = false;
  showMissingOnly = false;
  missingSessionPinnedIds.clear();

  const searchInput = document.getElementById("searchInput");
  const missingBtn = document.getElementById("missingFilterBtn");

  if (searchInput) {
    searchInput.value = "";
  }

  if (missingBtn) {
    missingBtn.classList.remove("active");
  }

  rerenderList();
  scrollToPokemonId(region.start);
}

function scrollToPokemonId(id, attempt = 0) {
  const target = document.querySelector('.pokemon-card[data-id="' + id + '"]');

  if (target) {
    const scrollPanel = document.querySelector('.list-wrap');

    if (scrollPanel && scrollPanel.contains(target)) {
      const panelRect = scrollPanel.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const targetTop = targetRect.top - panelRect.top + scrollPanel.scrollTop;
      const centeredTop = targetTop - scrollPanel.clientHeight / 2 + targetRect.height / 2;

      scrollPanel.scrollTo({
        top: Math.max(0, centeredTop),
        behavior: "smooth"
      });
    } else {
      target.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
    }

    target.classList.add("region-scroll-target");

    setTimeout(function () {
      target.classList.remove("region-scroll-target");
    }, 1200);

    return;
  }

  /*
    The list renders in chunks. Later regions may not exist immediately,
    so retry briefly until the target card has been created.
  */
  if (attempt < 100) {
    setTimeout(function () {
      scrollToPokemonId(id, attempt + 1);
    }, 25);
  }
}

// ----------------------
// CARD CREATION
// ----------------------

function createMetaBadge(type) {
  const badge = document.createElement("span");
  const eggDistance = /^\d+km$/.test(String(type || ""));

  /*
    Egg distance inherits the existing HATCH color language while communicating
    the useful source detail: 2KM / 5KM / 7KM / 10KM / 12KM.
  */
  badge.className = eggDistance
    ? "meta-badge hatch egg-distance " + type
    : "meta-badge " + type;

  if (eggDistance) {
    badge.textContent = String(type).toUpperCase();
  } else if (type === "mega") {
    badge.textContent = "MEGA";
  } else if (type === "raid") {
    badge.textContent = "RAID";
  } else if (type === "hatch") {
    badge.textContent = "HATCH";
  } else if (type === "lure") {
    badge.textContent = "LURE";
  } else if (type === "wild") {
    badge.textContent = "WILD";
  } else if (type === "research") {
    badge.textContent = "RESEARCH";
  } else if (type === "max") {
    badge.textContent = "MAX";
  } else if (type === "shadow") {
    badge.textContent = "SHADOW";
  }

  return badge;
}

function createPokemonCard(pokemon) {
  const isAvailable = pokemon.availability === "available";
  const isShiny = isAvailable && !!shinyMap[pokemon.id];
  const metaType = getMetaType(pokemon.id);

  const card = document.createElement("button");
  card.className = "pokemon-card";
  card.type = "button";
  card.dataset.id = pokemon.id;

  /*
    Compact and ultra-grid views intentionally hide the inline name. Keep the
    full name available on hover, keyboard focus, and native-browser tooltip
    without changing card density.
  */
  const pokemonLabel =
    "#" + (pokemon.id < 1000 ? String(pokemon.id).padStart(3, "0") : String(pokemon.id)) +
    " " + pokemon.name;
  card.dataset.pokemonLabel = pokemonLabel;
  card.setAttribute("aria-label", pokemonLabel);

  card.addEventListener("pointerenter", function (event) {
    if (event.pointerType === "touch") return;
    showCursorPokemonName(pokemonLabel, event.clientX, event.clientY);
  });

  card.addEventListener("pointermove", function (event) {
    if (event.pointerType === "touch") return;
    moveCursorPokemonName(event.clientX, event.clientY);
  });

  card.addEventListener("pointerleave", function () {
    hideCursorPokemonName();
  });

  card.addEventListener("focus", function () {
    const rect = card.getBoundingClientRect();
    showCursorPokemonName(
      pokemonLabel,
      rect.left + rect.width / 2,
      rect.top + rect.height / 2
    );
  });

  card.addEventListener("blur", function () {
    hideCursorPokemonName();
  });

  if (pokemon.availability === "shiny-locked") {
    card.classList.add("locked");
    card.disabled = true;
  } else if (pokemon.availability === "not-released") {
    card.classList.add("unreleased");
    card.disabled = true;
  } else if (isShiny) {
    card.classList.add("shiny");
  }

  if (showDexNumberBadges) {
    const dexBadge = document.createElement("span");
    dexBadge.className = "dex-number-badge";
    dexBadge.textContent =
  pokemon.id < 1000 ? String(pokemon.id).padStart(3, "0") : String(pokemon.id);
    card.appendChild(dexBadge);
  }

  if (metaType) {
    card.classList.add("meta-highlight");
    card.appendChild(createMetaBadge(metaType));
  }

  const sprite = document.createElement("img");
  sprite.className = "pokemon-sprite";
  sprite.src = getSpriteUrl(pokemon.id, isShiny);
  sprite.alt = pokemon.name;
  sprite.loading = "lazy";

  sprite.onerror = function () {
    if (isShiny) {
      sprite.src = getSpriteUrl(pokemon.id, false);
    }
  };

  const name = document.createElement("p");
  name.className = "pokemon-name";
  name.textContent = "#" + pokemon.id + " " + pokemon.name;

  const status = document.createElement("p");
  status.className = "pokemon-status";
  status.textContent = getStatusText(pokemon, isShiny);

  card.appendChild(sprite);
  card.appendChild(name);
  card.appendChild(status);

  const countdownText = getEventCountdownText(pokemon.id);

  if (countdownText) {
    const countdownBadge = document.createElement("span");
    countdownBadge.className = "event-countdown-badge";
    countdownBadge.textContent = countdownText;
    card.appendChild(countdownBadge);
  }

  return card;
}


// ----------------------
// REGION COMPLETION PANEL
// ----------------------

function initRegionCompletionPanel() {
  const toggle = document.getElementById("regionCompletionToggle");
  const panel = document.getElementById("regionCompletionPanel");
  const grid = document.getElementById("regionProgressGrid");

  if (!toggle || !panel || !grid) return;

  panel.hidden = true;
  panel.classList.remove("open");
  toggle.setAttribute("aria-expanded", "false");

  toggle.addEventListener("click", function () {
    setRegionCompletionOpen(!regionCompletionOpen);
  });

  if (typeof ResizeObserver !== "undefined") {
    if (regionCompletionResizeObserver) {
      regionCompletionResizeObserver.disconnect();
    }

    regionCompletionResizeObserver = new ResizeObserver(function () {
      syncRegionCompletionHeight();
    });

    regionCompletionResizeObserver.observe(grid);
  }

  syncRegionCompletionHeight();
}

function syncRegionCompletionHeight() {
  const panel = document.getElementById("regionCompletionPanel");
  const grid = document.getElementById("regionProgressGrid");

  if (!panel || !grid) return;

  panel.style.setProperty(
    "--region-completion-height",
    grid.scrollHeight + "px"
  );
}

function setRegionCompletionOpen(isOpen) {
  const toggle = document.getElementById("regionCompletionToggle");
  const panel = document.getElementById("regionCompletionPanel");

  if (!toggle || !panel) return;

  regionCompletionOpen = !!isOpen;
  panel.hidden = false;
  panel.classList.toggle("open", regionCompletionOpen);
  toggle.classList.toggle("open", regionCompletionOpen);
  toggle.setAttribute("aria-expanded", regionCompletionOpen ? "true" : "false");

  if (!regionCompletionOpen) {
    window.setTimeout(function () {
      if (!panel.classList.contains("open")) {
        panel.hidden = true;
      }
    }, 300);
  }
}

// ----------------------
// EVENT CAROUSEL
// ----------------------











// ----------------------
// RENDERING
// ----------------------

function getVisibleCardPositions() {
  const positions = {};

  Array.from(pokemonList.querySelectorAll(".pokemon-card[data-id]")).forEach(function (card) {
    positions[card.dataset.id] = card.getBoundingClientRect();
  });

  return positions;
}

function animateGridReflow(previousPositions) {
  const cards = Array.from(pokemonList.querySelectorAll(".pokemon-card[data-id]"));

  cards.forEach(function (card, index) {
    const previous = previousPositions[card.dataset.id];
    const current = card.getBoundingClientRect();

    if (previous) {
      const deltaX = previous.left - current.left;
      const deltaY = previous.top - current.top;

      if (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) {
        card.animate(
          [
            { transform: "translate(" + deltaX + "px, " + deltaY + "px)" },
            { transform: "translate(0, 0)" }
          ],
          { duration: 420, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
        );
      }
    } else {
      card.animate(
        [
          { opacity: 0, transform: "scale(0.94) translateY(8px)" },
          { opacity: 1, transform: "scale(1) translateY(0)" }
        ],
        { duration: 420, delay: Math.min(index, 40) * 6, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
      );
    }
  });
}

function renderInChunks() {
  const filtered = getFilteredPokemon();

  filtered.forEach(function (pokemon) {
    pokemonList.appendChild(createPokemonCard(pokemon));
  });
}

function rerenderList() {
  const previousPositions = getVisibleCardPositions();

  pokemonList.classList.add("pokemon-list-reflowing");
  pokemonList.innerHTML = "";
  renderInChunks();

  window.requestAnimationFrame(function () {
    animateGridReflow(previousPositions);

    window.setTimeout(function () {
      pokemonList.classList.remove("pokemon-list-reflowing");
    }, 460);
  });
}

// ----------------------
// CLICK HANDLER
// ----------------------

function handleCardClick(event) {
  const card = event.target.closest(".pokemon-card");

  if (!card) return;

  const id = Number(card.dataset.id);

  const pokemon = pokemonData.find(function (p) {
    return p.id === id;
  });

  if (!pokemon) return;
  if (pokemon.availability !== "available") return;

  const wasShiny = !!shinyMap[id];

  shinyMap[id] = !wasShiny;
  saveShinyData();
  updateProgress();

  const isShiny = !!shinyMap[id];

  /*
    Important:
    In UNREGISTERED mode, do NOT rerender after checking a Pokémon.
    Rerendering is what caused:
    - Pokémon disappearing immediately
    - scroll position jumping
  */
  if (showMissingOnly) {
    if (isShiny) {
      missingSessionPinnedIds.add(id);
    } else {
      missingSessionPinnedIds.delete(id);
    }
  }

  const sprite = card.querySelector(".pokemon-sprite");
  const status = card.querySelector(".pokemon-status");

  sprite.src = getSpriteUrl(id, isShiny);
  status.textContent = getStatusText(pokemon, isShiny);

  card.classList.toggle("shiny", isShiny);
}

// ----------------------
// INIT
// ----------------------

async function init() {
  pokemonList.innerHTML = "<p>Loading local Pokédex...</p>";

  /*
    Stage 1 — base app boot.
    This must succeed independently of Fandom. A network/parser issue in the
    optional event importer must never be reported as a Pokédex failure.
  */
  try {
    await loadPokemonData();
  } catch (error) {
    console.error("Local Pokédex boot failed:", error);
    pokemonList.innerHTML =
      "<p class=\"error\">Failed to load the local Pokédex. Check that <code>pokemon-species-local.js</code> is present beside <code>index.html</code>.</p>";
    return;
  }

  document.body.classList.add("compact-view");
  document.body.classList.toggle("ultra-grid-view", ultraGridView);

  window.__pokemonToolsetStartup = {
    pokedex: "loaded-local",
    events: "leek-duck-panel-ready"
  };


    document.body.classList.add("compact-view");
    document.body.classList.toggle("ultra-grid-view", ultraGridView);


    pokemonList.innerHTML = "";
    renderInChunks();
    updateProgress();
    initRegionCompletionPanel();

    pokemonList.addEventListener("click", handleCardClick);

    const searchInput = document.getElementById("searchInput");
    const missingBtn = document.getElementById("missingFilterBtn");
    const exportBtn = document.getElementById("exportBtn");
    const importBtn = document.getElementById("importBtn");
    const importFileInput = document.getElementById("importFileInput");
    const ultraGridBtn = document.getElementById("ultraGridBtn");
    const leekEventsBtn = document.getElementById("leekEventsBtn");

    if (leekEventsBtn) {
      leekEventsBtn.setAttribute("aria-expanded", "false");
      leekEventsBtn.addEventListener("click", function () {
        setLeekEventsOpen(!leekEventsOpen);
      });
    }

    initLeekEventResizeObserver();

    /*
      Build the manifest at launch. Opening Events only reveals already fetched
      information, so the animated dropdown never has to wrap a loading state.
    */
    refreshLeekDuckEvents();

    searchInput.addEventListener("input", function (e) {
      searchQuery = e.target.value.toLowerCase();

      /*
        Searching changes the visible list, but it should not erase the
        temporary UNREGISTERED pinned Pokémon.
      */
      rerenderList();
    });

    missingBtn.addEventListener("click", function () {
      /*
        Every time UNREGISTERED is clicked, reset the temporary session.
        This means:
        - first click enters a fresh UNREGISTERED list
        - second click exits and clears temporary pinned cards
        - clicking it again starts fresh
      */
      missingSessionPinnedIds.clear();

      showMissingOnly = !showMissingOnly;
      missingBtn.classList.toggle("active", showMissingOnly);
      rerenderList();
    });

    if (ultraGridBtn) {
      ultraGridBtn.classList.toggle("active", ultraGridView);
      ultraGridBtn.setAttribute("aria-pressed", ultraGridView ? "true" : "false");

      ultraGridBtn.addEventListener("click", function () {
        ultraGridView = !ultraGridView;
        localStorage.setItem("ultraGridView", ultraGridView ? "true" : "false");
        document.body.classList.toggle("ultra-grid-view", ultraGridView);
        ultraGridBtn.classList.toggle("active", ultraGridView);
        ultraGridBtn.setAttribute("aria-pressed", ultraGridView ? "true" : "false");
        rerenderList();
      });
    }

    exportBtn.addEventListener("click", function () {
      exportSaveData();
    });

    importBtn.addEventListener("click", function () {
      importFileInput.click();
    });

    importFileInput.addEventListener("change", function (event) {
      const file = event.target.files[0];

      if (file) {
        importSaveFile(file);
      }

      importFileInput.value = "";
    });

}

init();
