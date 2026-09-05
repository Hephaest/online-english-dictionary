import * as cheerio from "cheerio";
import type { Cheerio, CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import { httpClient, NetworkError } from "../http/client";
import type { HttpClient } from "../http/client";
import type { Badge, EntrySection, LookupResult, Picture, Pronunciation, Sense } from "../model/entry";
import type { DictionarySource, LookupOptions } from "./types";

const BASE_URL = "https://dictionary.cambridge.org";
const ENTRY_PATH = `${BASE_URL}/dictionary/english/`;

/** A miss keeps HTTP 200 and lands on the dictionary index instead of an entry. */
const INDEX_PATH = "/dictionary/english/";

function entrySlug(word: string): string {
  return encodeURIComponent(word.trim().toLowerCase().replace(/\s+/g, "-"));
}

function cleanText(element: Cheerio<Element>): string {
  return element.text().replace(/\s+/g, " ").trim();
}

/** Cambridge writes a phrase with hyphens in the URL and with spaces in the headword. */
function normalizeHeadword(word: string): string {
  return word
    .toLowerCase()
    .replace(/[-\s]+/g, " ")
    .trim();
}

function absoluteUrl(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${BASE_URL}${path}`;
}

/** The pronunciations of the block itself; nested spans belong to inflections such as "ran". */
function parsePronunciations(header: Cheerio<Element>): Pronunciation[] {
  const pronunciations: Pronunciation[] = [];
  for (const variant of ["us", "uk"] as const) {
    const block = header.children(`span.${variant}.dpron-i`).first();
    if (block.length === 0) continue;
    // The IPA is split across nested spans, so only the whole text of .ipa is complete.
    const text = cleanText(block.find(".ipa").first());
    const audioUrl = absoluteUrl(block.find('audio source[type="audio/mpeg"]').first().attr("src"));
    if (!text && !audioUrl) continue;
    pronunciations.push({ variant, text: text || undefined, notation: text ? "ipa" : undefined, audioUrl });
  }
  return pronunciations;
}

function parseSectionBadges(header: Cheerio<Element>): Badge[] {
  const grammar = cleanText(header.find(".posgram .gram.dgram").first());
  return grammar ? [{ kind: "grammar", text: grammar }] : [];
}

function parsePicture(block: Cheerio<Element>): Picture | undefined {
  const source = block.find(".dimg amp-img.dimg_i").first().attr("src");
  if (!source) return undefined;
  const thumbUrl = source.startsWith("http") ? source : `${BASE_URL}${source}`;
  // The full-size file is the same slug under /images/full/, which the page never prints as a plain URL.
  const fullUrl = thumbUrl.includes("/images/thumb/") ? thumbUrl.replace("/images/thumb/", "/images/full/") : undefined;
  const credit = cleanText(block.find(".dimg_c").first());
  return { thumbUrl, fullUrl, credit: credit || undefined };
}

/** A .lab wraps its own .region or .usage, so the wrapper decides the badge kind. */
function labelKind(label: Cheerio<Element>): Badge["kind"] {
  if (label.is(".gram")) return "grammar";
  if (label.is(".region") || label.find(".region").length > 0) return "region";
  if (label.is(".usage") || label.find(".usage").length > 0) return "register";
  return "label";
}

function parseSenseLabels($: CheerioAPI, block: Cheerio<Element>): Badge[] {
  const labels: Badge[] = [];
  const seen = new Set<string>();
  block
    .find(".def-info")
    .find(".gram.dgram, .lab.dlab, .region.dregion, .usage.dusage")
    .each((_, element) => {
      const node = $(element);
      // A .var holds a spelling variant, and a .region inside a .lab is already part of that label.
      if (node.parents(".var, .lab").length > 0) return;
      const text = cleanText(node);
      if (!text || seen.has(text)) return;
      seen.add(text);
      labels.push({ kind: labelKind(node), text });
    });
  return labels;
}

function parseSense($: CheerioAPI, element: Element, number: number, guideword: string, fallbackId: string): Sense {
  const block = $(element);
  const definition = cleanText(block.find(".def.ddef_d").first()).replace(/\s*:$/, "");
  const examples = block
    .find(".examp.dexamp .eg.deg")
    .map((_, example) => cleanText($(example)))
    .get()
    .filter((example) => example.length > 0);
  return {
    id: block.attr("data-wl-senseid") ?? fallbackId,
    number: String(number),
    heading: guideword || undefined,
    definition,
    examples,
    labels: parseSenseLabels($, block),
    cefr: cleanText(block.find(".def-info .epp-xref").first()) || undefined,
    picture: parsePicture(block),
  };
}

/** The name the dictionary block prints for itself, for example "American Dictionary". */
function dictionaryName(dictionary: Cheerio<Element>, pageName: string): string {
  const heading = cleanText(dictionary.find(".di-head .di-title").first());
  const separator = heading.lastIndexOf("|");
  const printed = separator >= 0 ? heading.slice(separator + 1).trim() : "";
  return printed || pageName;
}

/** The dictionary the page heading names, used by the first block, which prints no heading of its own. */
function pageDictionaryName($: CheerioAPI): string {
  const heading = cleanText($("h1").first());
  const separator = heading.lastIndexOf(" in ");
  return separator >= 0 ? heading.slice(separator + 4).trim() : "";
}

function parseBlock(
  $: CheerioAPI,
  element: Element,
  sectionId: string,
  dictionary: string,
  entryHeadword: string,
): EntrySection | undefined {
  const block = $(element);
  const header = block.find(".pos-header.dpos-h").first();
  const headword = cleanText(block.find(".di-title .headword").first());
  const partOfSpeech = cleanText(header.find(".pos.dpos").first()) || undefined;

  const senses: Sense[] = [];
  block.find(".pr.dsense").each((_, senseElement) => {
    const sense = $(senseElement);
    // Phrasal verb and idiom blocks listed under an entry are separate entries of their own.
    const nested = sense.closest(".pv-block, .idiom-block");
    if (nested.length > 0 && !nested.is(block)) return;
    const guideword = cleanText(sense.find(".dsense_h .guideword span").first());
    sense.find(".def-block.ddef_block").each((_, defElement) => {
      senses.push(parseSense($, defElement, senses.length + 1, guideword, `${sectionId}-${senses.length + 1}`));
    });
  });
  if (senses.length === 0) return undefined;

  // A phrasal verb page prints one block per pattern, so the pattern keeps the sections apart.
  const variant = headword && normalizeHeadword(headword) !== normalizeHeadword(entryHeadword) ? headword : undefined;
  return {
    id: sectionId,
    title: [dictionary, partOfSpeech, variant].filter(Boolean).join(" · "),
    partOfSpeech,
    pronunciations: parsePronunciations(header),
    badges: parseSectionBadges(header),
    senses,
  };
}

interface ParsedPage {
  headword: string;
  headwords: string[];
  sections: EntrySection[];
}

/**
 * Reads every dictionary on the page: one section per part-of-speech block of each British,
 * American, or Business block, or one section per pattern on a phrasal verb page.
 */
function parsePage($: CheerioAPI, word: string): ParsedPage {
  const pageName = pageDictionaryName($);
  const blocks: Array<{ element: Element; sectionId: string; dictionary: string }> = [];
  $("div.pr.dictionary").each((index, element) => {
    const dictionary = $(element);
    const dataId = dictionary.attr("data-id") ?? `dictionary-${index + 1}`;
    const entryBlocks = dictionary.find(".pr.entry-body__el");
    // A phrasal verb page has no part-of-speech block; its .pv-block elements are the entry.
    const own = entryBlocks.length > 0 ? entryBlocks : dictionary.find(".pv-block");
    own.each((position, blockElement) => {
      blocks.push({
        element: blockElement,
        sectionId: `${dataId}-${position + 1}`,
        dictionary: dictionaryName(dictionary, pageName),
      });
    });
  });

  const headwords = blocks.map(({ element }) => cleanText($(element).find(".di-title .headword").first()));
  const headword =
    headwords.find((candidate) => normalizeHeadword(candidate) === normalizeHeadword(word)) ?? headwords[0];
  const sections = blocks
    .map((block) => parseBlock($, block.element, block.sectionId, block.dictionary, headword ?? ""))
    .filter((section): section is EntrySection => section !== undefined);
  return { headword: headword ?? "", headwords, sections };
}

function unavailable(reason: "network" | "blocked" | "format-changed", message: string): LookupResult {
  return { status: "unavailable", reason, message };
}

/** The Cambridge Dictionary adapter, reading the British, American, and Business blocks of one entry page. */
export function createCambridgeSource(http: Pick<HttpClient, "fetchText"> = httpClient): DictionarySource {
  const entryUrl = (word: string) => `${ENTRY_PATH}${entrySlug(word)}`;

  async function lookup(word: string, options: LookupOptions): Promise<LookupResult> {
    let response;
    try {
      response = await http.fetchText(entryUrl(word), { signal: options.signal });
    } catch (error) {
      if (error instanceof NetworkError) return unavailable("network", error.message);
      throw error;
    }
    // HTTP 520 is what the origin answers to a User-Agent it refuses.
    if (response.status === 403 || response.status === 429 || response.status === 520) {
      return unavailable("blocked", `Cambridge refused the request (HTTP ${response.status})`);
    }
    if (response.status !== 200) return unavailable("network", `Cambridge answered HTTP ${response.status}`);

    // A miss answers HTTP 200 at the index page, and a near miss redirects to a different entry.
    if (new URL(response.url).pathname === INDEX_PATH) return { status: "not-found", suggestions: [] };
    const $ = cheerio.load(response.body);
    if ($("span.hw.dhw").length === 0) return { status: "not-found", suggestions: [] };

    const page = parsePage($, word);
    const printed = page.headwords.filter((headword) => headword.length > 0);
    if (printed.length === 0) return unavailable("format-changed", "The entry loaded but could not be read.");
    const wanted = normalizeHeadword(word);
    // Cambridge's own spelling correction landed on another entry: offer what it printed instead.
    if (!printed.some((headword) => normalizeHeadword(headword) === wanted)) {
      return { status: "not-found", suggestions: [...new Set(printed)] };
    }
    if (page.sections.length === 0) return unavailable("format-changed", "The entry loaded but could not be read.");

    return {
      status: "found",
      entry: { source: "cambridge", headword: page.headword, url: response.url, sections: page.sections },
    };
  }

  return {
    id: "cambridge",
    title: "Cambridge Dictionary",
    shortTitle: "Cambridge",
    homepage: BASE_URL,
    entryUrl,
    lookup,
  };
}
