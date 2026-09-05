import * as cheerio from "cheerio";
import type { Cheerio, CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import { httpClient, NetworkError } from "../http/client";
import type { HttpClient } from "../http/client";
import type { Badge, EntrySection, LookupResult, Picture, Pronunciation, Sense } from "../model/entry";
import type { DictionarySource, LookupOptions } from "./types";

const BASE_URL = "https://www.oxfordlearnersdictionaries.com";
const ENTRY_PATH = `${BASE_URL}/definition/english/`;
/** Owner-set constant: pages fetched for one word, the requested homograph plus the others it links to. */
const MAX_HOMOGRAPH_PAGES = 4;

type SenseLabelKind = Badge["kind"];

const LABEL_CLASSES: Record<string, SenseLabelKind> = {
  grammar: "grammar",
  labels: "register",
  cf: "label",
  use: "label",
  "dis-g": "label",
};

function entrySlug(word: string): string {
  return encodeURIComponent(word.trim().toLowerCase().replace(/\s+/g, "-"));
}

function cleanText(element: Cheerio<Element>): string {
  return element.text().replace(/\s+/g, " ").trim();
}

function stripSlashes(text: string): string {
  return text.replace(/^\/|\/$/g, "").trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function parsePronunciations($: CheerioAPI, webtop: Cheerio<Element>): Pronunciation[] {
  const blocks: Array<[Pronunciation["variant"], string]> = [
    ["us", ".phons_n_am"],
    ["uk", ".phons_br"],
  ];
  const pronunciations: Pronunciation[] = [];
  for (const [variant, selector] of blocks) {
    const block = webtop.find(`.phonetics ${selector}`).first();
    if (block.length === 0) continue;
    const text = stripSlashes(cleanText(block.find(".phon").first()));
    const audioUrl = block.find(".sound[data-src-mp3]").first().attr("data-src-mp3");
    if (!text && !audioUrl) continue;
    pronunciations.push({ variant, text: text || undefined, notation: text ? "ipa" : undefined, audioUrl });
  }
  return pronunciations;
}

function parseEntryBadges(webtop: Cheerio<Element>): Badge[] {
  const badges: Badge[] = [];
  const levelClass = webtop.find(".symbols span[class^='ox3ksym_']").first().attr("class") ?? "";
  const level = levelClass.split("_")[1];
  if (level) badges.push({ kind: "cefr", text: level.toUpperCase() });
  const headword = webtop.find("h1.headword").first();
  if (headword.attr("ox3000") === "y") badges.push({ kind: "label", text: "Oxford 3000" });
  else if (headword.attr("ox5000") === "y") badges.push({ kind: "label", text: "Oxford 5000" });
  return badges;
}

function parsePicture($: CheerioAPI, sense: Cheerio<Element>): Picture | undefined {
  const thumbUrl = sense.find("img.thumb[src]").first().attr("src");
  if (!thumbUrl) return undefined;
  const fullUrl = sense.find("a.topic[href]").first().attr("href");
  return { thumbUrl, fullUrl: fullUrl || undefined };
}

function parseSenseLabels($: CheerioAPI, sense: Cheerio<Element>): Badge[] {
  const seen = new Set<string>();
  const labels: Badge[] = [];
  sense
    .find(
      Object.keys(LABEL_CLASSES)
        .map((name) => `.${name}`)
        .join(", "),
    )
    .each((_, element) => {
      const node = $(element);
      if (node.closest("ul.examples, .unbox, .collapse").length > 0) return;
      const className = (node.attr("class") ?? "").split(/\s+/).find((name) => name in LABEL_CLASSES);
      const text = cleanText(node);
      if (!className || !text || seen.has(text)) return;
      seen.add(text);
      labels.push({ kind: LABEL_CLASSES[className], text });
    });
  return labels;
}

function parseSense($: CheerioAPI, element: Element, number: number, fallbackId: string): Sense {
  const sense = $(element);
  const primary = sense
    .find("ul.examples span.x")
    .map((_, example) => cleanText($(example)))
    .get();
  const extra = sense
    .find(".unbox[unbox='extra_examples'] span.unx")
    .map((_, example) => cleanText($(example)))
    .get();
  return {
    id: sense.attr("id") ?? fallbackId,
    number: String(number),
    definition: cleanText(sense.find(".def").first()),
    examples: unique([...primary, ...extra]),
    labels: parseSenseLabels($, sense),
    cefr: sense.attr("fkcefr")?.toUpperCase(),
    picture: parsePicture($, sense),
  };
}

interface ParsedPage {
  headword: string;
  sections: EntrySection[];
}

/** Reads one homograph page: the requested part of speech, grouped by the page's own shortcut headings. */
function parsePage($: CheerioAPI, pageUrl: string): ParsedPage | undefined {
  const entry = $("#entryContent .entry").first();
  if (entry.length === 0) return undefined;
  const webtop = entry.find(".top-container .webtop").first();
  const headword = cleanText(webtop.find("h1.headword").first());
  const partOfSpeech = cleanText(webtop.find("span.pos").first()) || undefined;
  const pronunciations = parsePronunciations($, webtop);
  const badges = parseEntryBadges(webtop);
  const pageId = pageUrl.slice(ENTRY_PATH.length) || entrySlug(headword);

  const sections: EntrySection[] = [];
  let senseNumber = 0;
  const pushSection = (groupTitle: string | undefined, senseElements: Element[]) => {
    if (senseElements.length === 0) return;
    const senses = senseElements.map((element) => parseSense($, element, ++senseNumber, `${pageId}-${senseNumber}`));
    const title = [partOfSpeech ?? headword, groupTitle].filter(Boolean).join(" · ");
    sections.push({ id: `${pageId}-${sections.length + 1}`, title, partOfSpeech, pronunciations, badges, senses });
  };

  const list = entry.children("ol.senses_multiple, ol.sense_single").first();
  const ungrouped: Element[] = [];
  list.children().each((_, child) => {
    const node = $(child);
    if (node.is("li.sense")) {
      ungrouped.push(child);
      return;
    }
    if (node.is("span.shcut-g")) {
      pushSection(cleanText(node.find("h2.shcut").first()) || undefined, node.children("li.sense").get());
    }
  });
  pushSection(undefined, ungrouped);
  return { headword, sections };
}

/** Other homographs of the same word, from the navigation list that marks the current entry as selected. */
function homographUrls($: CheerioAPI, pageUrl: string): string[] {
  const selected = $(`a.selected[href^='${ENTRY_PATH}']`).first();
  if (selected.length === 0) return [];
  const base = (selected.attr("href") ?? "").slice(ENTRY_PATH.length).replace(/_\d+$/, "");
  const pattern = new RegExp(`^${ENTRY_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${base}_\\d+$`);
  const urls = selected
    .closest("ul")
    .find("a[href]")
    .map((_, anchor) => $(anchor).attr("href") ?? "")
    .get()
    .filter((href) => pattern.test(href) && href !== pageUrl);
  return unique(urls);
}

function unavailable(reason: "network" | "blocked" | "format-changed", message: string): LookupResult {
  return { status: "unavailable", reason, message };
}

export function createOxfordLearnersSource(http: Pick<HttpClient, "fetchText"> = httpClient): DictionarySource {
  const entryUrl = (word: string) => `${ENTRY_PATH}${entrySlug(word)}`;

  // Accepted limitation: a homograph page that fails is left out silently, and the shorter entry stays cached until the command is relaunched.
  async function fetchPage(url: string): Promise<ParsedPage | undefined> {
    try {
      const response = await http.fetchText(url);
      if (response.status !== 200) return undefined;
      return parsePage(cheerio.load(response.body), response.url);
    } catch {
      return undefined;
    }
  }

  async function lookup(word: string): Promise<LookupResult> {
    let response;
    try {
      response = await http.fetchText(entryUrl(word));
    } catch (error) {
      if (error instanceof NetworkError) return unavailable("network", error.message);
      throw error;
    }
    if (response.status === 404) return { status: "not-found", suggestions: [] };
    if (response.status === 403 || response.status === 429) {
      return unavailable("blocked", `Oxford Learner's refused the request (HTTP ${response.status})`);
    }
    if (response.status !== 200) return unavailable("network", `Oxford Learner's answered HTTP ${response.status}`);

    const $ = cheerio.load(response.body);
    const first = parsePage($, response.url);
    if (!first || first.sections.length === 0) {
      return unavailable("format-changed", "The entry loaded but could not be read.");
    }

    const otherPages = await Promise.all(
      homographUrls($, response.url)
        .slice(0, MAX_HOMOGRAPH_PAGES - 1)
        .map((url) => fetchPage(url)),
    );
    const sections = [first, ...otherPages].flatMap((page) => page?.sections ?? []);
    return {
      status: "found",
      entry: { source: "oxford-learners", headword: first.headword, url: response.url, sections },
    };
  }

  return {
    id: "oxford-learners",
    title: "Oxford Learner's Dictionaries",
    shortTitle: "Oxford Learner's",
    homepage: BASE_URL,
    entryUrl,
    lookup,
  };
}
