import * as cheerio from "cheerio";

const clean = value => String(value || "").replace(/\s+/g, " ").trim();

/**
 * Intentionally broad first-pass inspection. It does NOT classify Pokémon yet.
 * It records headings plus nodes containing likely Pokémon/media markers so we
 * can establish LeekDuck's actual DOM contract before writing brittle rules.
 */
export function auditEventPage(html, event) {
  const $ = cheerio.load(html);
  const headings = [];
  $("h1,h2,h3,h4,h5,h6").each((_, element) => {
    const text = clean($(element).text());
    if (text) headings.push({ tag: element.tagName, text });
  });

  const imageSignals = [];
  $("img").each((_, image) => {
    const alt = clean($(image).attr("alt"));
    const src = $(image).attr("src") || "";
    const parentText = clean($(image).parent().text()).slice(0, 220);
    if (/pokemon|shiny|icon|sprite/i.test(`${alt} ${src} ${parentText}`)) {
      imageSignals.push({ alt, src, parentText });
    }
  });

  const classSignals = new Map();
  $("[class]").each((_, element) => {
    const className = $(element).attr("class") || "";
    if (!/pokemon|shiny|raid|egg|research|encounter/i.test(className)) return;
    const key = className.trim();
    if (!classSignals.has(key)) {
      classSignals.set(key, {
        className: key,
        tag: element.tagName,
        sampleText: clean($(element).text()).slice(0, 250),
        sampleHtml: $.html(element).slice(0, 700)
      });
    }
  });

  return {
    event,
    document: {
      title: clean($("title").first().text()),
      headingCount: headings.length,
      imageCount: $("img").length
    },
    headings,
    likelyPokemonOrShinyImages: imageSignals.slice(0, 250),
    relevantClassSamples: [...classSignals.values()].slice(0, 250)
  };
}
