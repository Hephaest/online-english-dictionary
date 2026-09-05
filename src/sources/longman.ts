import * as cheerio from "cheerio";
import type { Cheerio, CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import { httpClient, NetworkError } from "../http/client";
import type { HttpClient } from "../http/client";
import type { Badge, EntrySection, LookupResult, Picture, Pronunciation, Sense } from "../model/entry";
import type { DictionarySource } from "./types";

const BASE_URL = "https://www.ldoceonline.com";
const ENTRY_PATH = `${BASE_URL}/dictionary/`;
/** Illustrations live under this media path, but the site-wide "Pictures of the day" decoys use it too, so always scope by container. */
const ILLUSTRATION_PATH = "/media/english/illustration/";

function entrySlug(word: string): string {
  return encodeURIComponent(word.trim().toLowerCase().replace(/\s+/g, "-"));
}

function cleanText(element: Cheerio<Element>): string {
  return element.text().replace(/\s+/g, " ").trim();
}

/** Reads one span without the punctuation the page prints around it inside span.neutral children. */
function labelText(element: Cheerio<Element>): string {
  if (element.length === 0) return "";
  const copy = element.first().clone();
  copy.find(".neutral").remove();
  return cleanText(copy);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function absoluteUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value, BASE_URL).toString();
  } catch {
    return undefined;
  }
}

/**
 * Merges Longman's American variant suffix onto the British transcription.
 * "-ər" over "kəmˈpjuːtə" gives "kəmˈpjuːtər": the suffix replaces the longest tail of the base that it also starts with.
 */
function mergeAmericanVariant(british: string, variant: string): string {
  if (!variant.startsWith("-")) return variant;
  const suffix = variant.slice(1);
  if (!suffix) return british;
  for (let index = 0; index <= british.length; index++) {
    if (suffix.startsWith(british.slice(index))) return british.slice(0, index) + suffix;
  }
  return british + suffix;
}

/** Reads .PRON and .AMEVARPRON separately; .text() on the whole .PronCodes would splice them into a nonsense string. */
function parsePronunciations(head: Cheerio<Element>): Pronunciation[] {
  const codes = head.children(".PronCodes").first();
  const british = labelText(codes.children(".PRON"));
  const variant = labelText(codes.children(".AMEVARPRON"));
  const american = british && variant ? mergeAmericanVariant(british, variant) : variant || british;
  const usAudio = absoluteUrl(head.children("span.speaker.amefile[data-src-mp3]").first().attr("data-src-mp3"));
  const ukAudio = absoluteUrl(head.children("span.speaker.brefile[data-src-mp3]").first().attr("data-src-mp3"));

  const pronunciations: Pronunciation[] = [];
  if (american || usAudio) {
    pronunciations.push({
      variant: "us",
      text: american || undefined,
      notation: american ? "ipa" : undefined,
      audioUrl: usAudio,
    });
  }
  if (british || ukAudio) {
    pronunciations.push({
      variant: "uk",
      text: british || undefined,
      notation: british ? "ipa" : undefined,
      audioUrl: ukAudio,
    });
  }
  return pronunciations;
}

/** Badge classes carried as direct children of the headword block or of one sense. */
const BADGE_CLASSES: Array<[string, Badge["kind"]]> = [
  ["FREQ", "frequency"],
  ["GRAM", "grammar"],
  ["REGISTERLAB", "register"],
  ["SIGNPOST", "label"],
];

function parseBadges($: CheerioAPI, scope: Cheerio<Element>): Badge[] {
  const badges: Badge[] = [];
  const seen = new Set<string>();
  for (const [className, kind] of BADGE_CLASSES) {
    scope.children(`.${className}`).each((_, element) => {
      const text = labelText($(element));
      if (!text || seen.has(text)) return;
      seen.add(text);
      badges.push({ kind, text });
    });
  }
  return badges;
}

function parseExamples($: CheerioAPI, scope: Cheerio<Element>): string[] {
  return unique(
    scope
      .find("span.EXAMPLE")
      .map((_, element) => {
        const copy = $(element).clone();
        copy.find(".speaker").remove();
        return cleanText(copy);
      })
      .get(),
  );
}

/** Longman prints a phrase sense as an arrow plus the phrase it points to, with no definition of its own. */
function crossReferenceText($: CheerioAPI, scope: Cheerio<Element>): string {
  return scope
    .children("span.Crossref")
    .map((_, element) => cleanText($(element) as Cheerio<Element>))
    .get()
    .join(" ");
}

function parsePicture(scope: Cheerio<Element>): Picture | undefined {
  const thumbUrl = absoluteUrl(scope.find(`img[src*='${ILLUSTRATION_PATH}']`).first().attr("src"));
  return thumbUrl ? { thumbUrl } : undefined;
}

/** The sense body without its sub-senses, so a parent's fields never absorb a child's. */
function withoutSubsenses(sense: Cheerio<Element>): Cheerio<Element> {
  const copy = sense.first().clone();
  copy.children("span.Subsense").remove();
  return copy as Cheerio<Element>;
}

function buildSense($: CheerioAPI, scope: Cheerio<Element>, id: string, number: string, extra: Badge[]): Sense {
  return {
    id,
    number,
    definition: cleanText(scope.find("span.DEF").first()) || crossReferenceText($, scope),
    examples: parseExamples($, scope),
    labels: [...extra, ...parseBadges($, scope)],
    picture: parsePicture(scope),
  };
}

/** One span.Sense becomes one sense, or one sense per span.Subsense when the page splits it into a) b) c). */
function parseSense($: CheerioAPI, element: Element, sectionId: string, position: number): Sense[] {
  const sense = $(element) as Cheerio<Element>;
  const own = withoutSubsenses(sense);
  const number = labelText(own.children(".sensenum")) || String(position);
  const signposts = parseBadges($, own).filter((badge) => badge.kind === "label");
  const subsenses = sense.children("span.Subsense");
  if (subsenses.length === 0) return [buildSense($, own, `${sectionId}-${number}`, number, [])];

  return subsenses
    .map((index, child) => {
      const subsense = $(child) as Cheerio<Element>;
      const letter = labelText(subsense.children(".sensenum")).replace(/[^\w]/g, "") || String(index + 1);
      return buildSense($, subsense, `${sectionId}-${number}${letter}`, `${number}${letter}`, signposts);
    })
    .get();
}

/** "From Longman Dictionary of Contemporary English" becomes "Contemporary English"; the Business title becomes "Business". */
function dictionaryName(intro: string): string {
  return intro
    .replace(/^From\s+/i, "")
    .replace(/^Longman\s+/i, "")
    .replace(/^Dictionary of\s+/i, "")
    .replace(/\s+Dictionary$/i, "")
    .trim();
}

interface ParsedEntry {
  headword: string;
  dictionary: string;
  section: EntrySection;
}

function parseEntry($: CheerioAPI, element: Element, slug: string, position: number): ParsedEntry | undefined {
  const entry = $(element) as Cheerio<Element>;
  const head = entry.find("span.Head").first();
  const raw = cleanText(head.children(".HWD").first()) || cleanText(head.children(".HYPHENATION").first());
  if (!raw) return undefined;
  const headword = raw.replace(/‧/g, "");

  const sectionId = `${slug}-${position}`;
  const senses = entry
    .find("span.Sense")
    .map((index, sense) => parseSense($, sense, sectionId, index + 1))
    .get()
    .flat()
    .filter((sense) => sense.definition.length > 0 || sense.examples.length > 0);

  // The illustration belongs to the section only when it sits outside every sense.
  const loose = entry.clone();
  loose.find("span.Sense").remove();

  // The homograph number tells two blocks apart when they share a part of speech, so the title has to carry it.
  const partOfSpeech = cleanText(head.children(".POS").first()) || undefined;
  const homographNumber = labelText(head.children(".HOMNUM"));
  const name = partOfSpeech ?? headword;

  return {
    headword,
    dictionary: dictionaryName(cleanText(entry.find(".dictionary_intro").first())),
    section: {
      id: sectionId,
      title: homographNumber ? `${name} (${homographNumber})` : name,
      partOfSpeech,
      pronunciations: parsePronunciations(head),
      badges: parseBadges($, head),
      senses,
      picture: parsePicture(loose as Cheerio<Element>),
    },
  };
}

function unavailable(reason: "network" | "blocked" | "format-changed", message: string): LookupResult {
  return { status: "unavailable", reason, message };
}

/** A miss answers HTTP 200 on the spellcheck page, so the page itself has to say so. */
function missResult($: CheerioAPI, url: string): LookupResult | undefined {
  const looksLikeSpellcheck =
    url.includes("/spellcheck/") || $(".search_title").length > 0 || $("ul.didyoumean").length > 0;
  if (!looksLikeSpellcheck) return undefined;
  const suggestions = unique(
    $("ul.didyoumean li a")
      .map((_, anchor) => cleanText($(anchor) as Cheerio<Element>))
      .get(),
  );
  return { status: "not-found", suggestions };
}

/**
 * Builds the Longman Dictionary of Contemporary English adapter, which scrapes ldoceonline.com entry pages.
 */
export function createLongmanSource(http: Pick<HttpClient, "fetchText"> = httpClient): DictionarySource {
  const entryUrl = (word: string) => `${ENTRY_PATH}${entrySlug(word)}`;

  async function lookup(word: string): Promise<LookupResult> {
    let response;
    try {
      response = await http.fetchText(entryUrl(word));
    } catch (error) {
      if (error instanceof NetworkError) return unavailable("network", error.message);
      throw error;
    }
    if (response.status === 403 || response.status === 429) {
      return unavailable("blocked", `Longman refused the request (HTTP ${response.status})`);
    }
    if (response.status !== 200) return unavailable("network", `Longman answered HTTP ${response.status}`);

    const $ = cheerio.load(response.body);
    const slug = entrySlug(word);
    const entries = $("span.dictentry")
      .map((index, element) => parseEntry($, element, slug, index + 1))
      .get()
      .filter((entry): entry is ParsedEntry => entry !== undefined);

    if (entries.length === 0) {
      return missResult($, response.url) ?? unavailable("format-changed", "The page loaded but held no entry markup.");
    }

    // The dictionary name is printed once per block, so later homographs inherit the last one seen.
    let currentDictionary = "";
    for (const entry of entries) {
      if (entry.dictionary) currentDictionary = entry.dictionary;
      entry.dictionary = currentDictionary;
    }
    const manyDictionaries = new Set(entries.map((entry) => entry.dictionary)).size > 1;
    const sections = entries.map((entry) => ({
      ...entry.section,
      title:
        manyDictionaries && entry.dictionary ? `${entry.section.title} · ${entry.dictionary}` : entry.section.title,
    }));

    return {
      status: "found",
      entry: { source: "longman", headword: entries[0].headword, url: response.url, sections },
    };
  }

  return {
    id: "longman",
    title: "Longman Dictionary",
    shortTitle: "Longman",
    homepage: BASE_URL,
    entryUrl,
    lookup,
  };
}
