/*
  Local LeekDuck event-data adapter.
  The Node importer owns fetch/parse work. The browser only reads the generated
  data file that index.html loads before this adapter.
*/
(function () {
  "use strict";

  function uniqueNumbers(values) {
    return [...new Set((values || []).map(Number).filter(Number.isFinite))];
  }

  function legacyBuckets(event) {
    const source = event && event.pokemonLegacy ? event.pokemonLegacy : {};
    const details = Array.isArray(event && event.pokemon) ? event.pokemon : [];
    const roster = source.roster && source.roster.length
      ? source.roster
      : details.map(function (pokemon) { return pokemon.speciesId; });

    return {
      roster: uniqueNumbers(roster),
      wild: uniqueNumbers(source.wild),
      raid: uniqueNumbers(source.raid),
      maxBattle: uniqueNumbers(source.maxBattle),
      lure: uniqueNumbers(source.lure),
      egg: uniqueNumbers(source.egg),
      egg2km: uniqueNumbers(source.egg2km),
      egg5km: uniqueNumbers(source.egg5km),
      egg7km: uniqueNumbers(source.egg7km),
      egg10km: uniqueNumbers(source.egg10km),
      egg12km: uniqueNumbers(source.egg12km),
      research: uniqueNumbers(source.research),
      shiny: uniqueNumbers(source.shiny),
      shinyDebuts: uniqueNumbers(source.shinyDebuts)
    };
  }

  function isDisplayableEvent(event, now = Date.now()) {
    const title = String(event && (event.name || event.title) || "").trim().toLowerCase();
    const category = String(event && event.category || "").trim().toLowerCase();
    const endMs = Date.parse(event && event.end);

    /* GO Pass pages are progression tracks, not event cards for this tracker.
       Ended events are intentionally retained in generated audit data but not
       presented in the live Event drawer. */
    if (title.startsWith("go pass") || category === "go pass") return false;
    return !Number.isFinite(endMs) || endMs >= now;
  }

  function chronologicalByStart(left, right) {
    const leftTime = Date.parse(left && left.start);
    const rightTime = Date.parse(right && right.start);
    const normalizedLeft = Number.isFinite(leftTime) ? leftTime : Number.MAX_SAFE_INTEGER;
    const normalizedRight = Number.isFinite(rightTime) ? rightTime : Number.MAX_SAFE_INTEGER;
    return normalizedLeft - normalizedRight || String(left.title).localeCompare(String(right.title));
  }

  function adaptEvent(event) {
    const pokemonDetails = Array.isArray(event.pokemon) ? event.pokemon : [];
    const category = event.category || "Event";

    return {
      id: event.id,
      url: event.url,
      title: event.name || event.title || "Event",
      category: category,
      displayCategory: category,
      start: event.start,
      end: event.end,
      listedStart: event.listedStart || event.start,
      warnings: Array.isArray(event.warnings) ? event.warnings : [],
      pokemon: legacyBuckets(event),
      pokemonDetails: pokemonDetails
    };
  }

  window.loadLeekDuckEvents = async function loadLeekDuckEvents() {
    const generated = window.LEEKDUCK_EVENT_DATA;

    if (!generated || !Array.isArray(generated.events)) {
      throw new Error("Generated event data is missing. Run npm run refresh:events from the project folder.");
    }

    return {
      manifest: {
        source: "LeekDuck local generated data",
        generatedAt: generated.generatedAt || null,
        eventCount: generated.eventCount || generated.events.length
      },
      /*
        This registry is deliberately independent of the visible event list.
        Once Leek Duck confirms a shiny, an expired event must not lock it
        again in the tracker.
      */
      shinyAvailableIds: uniqueNumbers([
        ...(generated.shinyAvailableIds || []),
        ...generated.events.flatMap(function (event) {
          return event && event.pokemonLegacy
            ? event.pokemonLegacy.shinyDebuts || []
            : [];
        })
      ]),
      events: generated.events
        .filter((event) => isDisplayableEvent(event))
        .map(adaptEvent)
        .sort(chronologicalByStart)
    };
  };
})();
