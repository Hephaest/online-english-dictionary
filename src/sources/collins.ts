import * as cheerio from "cheerio";
import type { Cheerio, CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import { z } from "zod";
import { httpClient, NetworkError } from "../http/client";
import type { HttpClient } from "../http/client";
import type {
  AccentVariant,
  Badge,
  EntrySection,
  LookupResult,
  Pronunciation,
  Sense,
  UnavailableReason,
} from "../model/entry";
import type { CollinsCredentials, CollinsDictionary, DictionarySource, LookupOptions } from "./types";

const SITE_BASE = "https://www.collinsdictionary.com";
const API_BASE = "https://api.collinsdictionary.com/api/v1/dictionaries";

/** Collins' licence requires this line, unchanged, wherever its content is shown. */
const ATTRIBUTION = "www.collinsdictionary.com © HarperCollins Publishers Ltd 2025";

/** Collins' didyoumean returns up to ten suggestions; five is an owner-set choice, short enough to scan in the list. */
const SUGGESTION_COUNT = 5;

/** Owner-set cap: Collins documents one short reason line, so longer text is not it and is dropped rather than shown. */
const MAX_SERVER_REASON_LENGTH = 200;

const MISSING_KEY_MESSAGE =
  "Collins needs a key from the Collins Dictionary API portal. Paste it into the Collins API Key preference.";
const REJECTED_KEY_MESSAGE =
  "Collins refused the key. Check the Collins API Key preference, and make sure the Collins Dictionary preference names a dictionary the key is subscribed to.";
const BOT_WALL_MESSAGE =
  "The Collins API host turned this request away before it reached Collins, so the key is not at fault. It happens in bursts and clears on its own, so try again.";

/**
 * Owner-set constant: the pause before each further attempt when the host turns a request away.
 * Measured against the live API, the first request after a quiet spell is the one refused and the next
 * is usually let through, so two extra attempts clear nearly all of them while adding at most two seconds.
 */
const CHALLENGE_RETRY_DELAYS_MS = [700, 1500];

/** The browsable page each API dictionary is published on, so "Open in Collins" opens the dictionary that was read. */
// TODO(collins-american-path): Collins publishes one Cobuild section and no separate Advanced American path could be confirmed, so both Cobuild codes point at it.
const PUBLIC_DICTIONARY_PATHS: Record<CollinsDictionary, string> = {
  english: "english",
  "english-learner": "english-cobuild-learners",
  "american-learner": "english-cobuild-learners",
};

/** The whole entryContent markup vocabulary, so a Collins redesign is read and repaired in one place. */
const SELECTORS = {
  entry: "div.entry",
  headword: "h1.hwd",
  frequencyBand: "span.lbfreq",
  pronunciation: "span.pron",
  /** The playback link, its icon and the clip all sit inside span.pron and would pollute the IPA. */
  playbackControls: "a.playback, img, audio",
  audioSource: "audio source",
  /** A part-of-speech block in the english dictionary, a numbered sense in the Cobuild ones. */
  homograph: "div.hom",
  senseNumber: "span.sensenum",
  partOfSpeech: "span.gramGrp span.pos",
  grammarLabel: "span.gramGrp span.lbl",
  sense: "div.sense",
  definition: "span.def",
  example: "span.cit span.quote",
  /** An inflected form and a run-on derivative carry their own pronunciation, part of speech and examples. */
  nestedForms: "div.formTypeInfl, span.re",
} as const;

const entrySchema = z.object({
  entryId: z.string().optional(),
  entryLabel: z.string().optional(),
  entryContent: z.string(),
});

const suggestionsSchema = z.object({ suggestions: z.array(z.string()) });

/** Collins documents an exception body of { errorCode, errorMessage }. */
const serverErrorSchema = z.object({
  errorCode: z.union([z.number(), z.string()]).optional(),
  errorMessage: z.string().optional(),
});

type EntryPayload = z.infer<typeof entrySchema>;

function parseJson<T>(schema: z.ZodType<T>, body: string): T | undefined {
  try {
    return schema.parse(JSON.parse(body));
  } catch {
    return undefined;
  }
}

function normalizeWord(word: string): string {
  return word.trim().toLowerCase();
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function cleanText(element: Cheerio<Element>): string {
  return collapse(element.text());
}

/**
 * A bot wall in front of the API, rather than Collins turning the key down.
 * Collins answers JSON to every request, so an HTML body under 401 or 403 never came from Collins at all:
 * their host is fronted by a challenge page that refuses any client it does not read as a browser.
 * Telling these apart matters because the two have opposite fixes, and only one of them is the reader's to make.
 */
function isBotWall(contentType: string): boolean {
  return !contentType.toLowerCase().includes("json");
}

/** The host refused the request instead of passing it to Collins, which is worth one more attempt. */
function turnedAway(response: { status: number; contentType: string }): boolean {
  return (response.status === 401 || response.status === 403) && isBotWall(response.contentType);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Collins' own words about a failure, shown only when the body is the documented shape and reads as one short line. */
function serverReason(body: string): string | undefined {
  const text = collapse(parseJson(serverErrorSchema, body)?.errorMessage ?? "");
  if (!text || text.length > MAX_SERVER_REASON_LENGTH) return undefined;
  return text;
}

/** The english dictionary prints "1. " while every renderer appends its own period, so the number is kept bare. */
function bareSenseNumber(text: string): string {
  return text.replace(/[^\p{L}\p{N}]+$/u, "");
}

/** The nodes a block prints for itself, leaving out those an inflected form or a run-on derivative owns. */
function own($: CheerioAPI, nodes: Cheerio<Element>): Cheerio<Element> {
  return nodes.filter((_, element) => $(element).closest(SELECTORS.nestedForms).length === 0);
}

/** The entry's language class decides the accent; anything but lang_en-us is Collins' British default. */
function accentOf(entry: Cheerio<Element>): AccentVariant {
  return (entry.attr("class") ?? "").split(/\s+/).includes("lang_en-us") ? "us" : "uk";
}

function parsePronunciations($: CheerioAPI, entry: Cheerio<Element>): Pronunciation[] {
  const block = own($, entry.find(SELECTORS.pronunciation)).first();
  if (block.length === 0) return [];
  const audioUrl = block.find(SELECTORS.audioSource).first().attr("src");
  // The clip is embedded in the markup, so the IPA is only readable once the playback markup is gone.
  const spoken = block.clone();
  spoken.find(SELECTORS.playbackControls).remove();
  const text = cleanText(spoken);
  if (!text && !audioUrl) return [];
  return [{ variant: accentOf(entry), text: text || undefined, notation: text ? "ipa" : undefined, audioUrl }];
}

function parseFrequencyBadges($: CheerioAPI, entry: Cheerio<Element>): Badge[] {
  const band = cleanText(own($, entry.find(SELECTORS.frequencyBand)).first());
  return band ? [{ kind: "frequency", text: band }] : [];
}

function parseGrammarBadges($: CheerioAPI, homograph: Cheerio<Element>): Badge[] {
  const seen = new Set<string>();
  const badges: Badge[] = [];
  own($, homograph.find(SELECTORS.grammarLabel)).each((_, element) => {
    const text = cleanText($(element));
    if (!text || seen.has(text)) return;
    seen.add(text);
    badges.push({ kind: "grammar", text });
  });
  return badges;
}

function quoteTexts($: CheerioAPI, quotes: Cheerio<Element>): string[] {
  return own($, quotes)
    .map((_, element) => cleanText($(element)))
    .get()
    .filter((example) => example.length > 0);
}

function parseHomograph($: CheerioAPI, element: Element, sectionId: string, startNumber: number): Sense[] {
  const homograph = $(element);
  const badges = parseGrammarBadges($, homograph);
  const outsideSenses = (_: number, node: Element) => $(node).closest(SELECTORS.sense).length === 0;
  // The Cobuild dictionaries number the block itself; the english dictionary numbers each sense inside it.
  const blockNumber = bareSenseNumber(
    cleanText(own($, homograph.find(SELECTORS.senseNumber)).filter(outsideSenses).first()),
  );
  const beside = quoteTexts($, homograph.find(SELECTORS.example).filter(outsideSenses));

  const senses: Sense[] = [];
  own($, homograph.find(SELECTORS.sense)).each((_, senseElement) => {
    const sense = $(senseElement);
    const definition = cleanText(own($, sense.find(SELECTORS.definition)).first());
    // A block that only cross-references another entry, such as a span.xr, has no definition to show.
    if (!definition) return;
    const number = startNumber + senses.length;
    senses.push({
      id: `${sectionId}-${number}`,
      number:
        bareSenseNumber(cleanText(own($, sense.find(SELECTORS.senseNumber)).first())) || blockNumber || String(number),
      definition,
      // A quote printed beside the senses rather than inside one belongs to the first sense of the block.
      examples: [...quoteTexts($, sense.find(SELECTORS.example)), ...(senses.length === 0 ? beside : [])],
      labels: badges,
    });
  });
  return senses;
}

/** One section per distinct part of speech, formed from the run of blocks that share it. */
interface SectionDraft {
  partOfSpeech: string;
  elements: Element[];
}

function groupByPartOfSpeech($: CheerioAPI, homographs: Cheerio<Element>): SectionDraft[] {
  const drafts: SectionDraft[] = [];
  homographs.each((_, element) => {
    const partOfSpeech = cleanText(own($, $(element).find(SELECTORS.partOfSpeech)).first());
    const current = drafts[drafts.length - 1];
    // A block that prints no part of speech of its own continues the block above it.
    if (current && (!partOfSpeech || partOfSpeech === current.partOfSpeech)) current.elements.push(element);
    else drafts.push({ partOfSpeech, elements: [element] });
  });
  return drafts;
}

interface ParsedEntry {
  headword: string;
  sections: EntrySection[];
}

// TODO(collins-extras): the run-on derivative (span.re) and the etymology (div.etym) are read past, because the Entry model has no field for either.
function parseEntry(payload: EntryPayload, word: string): ParsedEntry {
  const $ = cheerio.load(payload.entryContent);
  const entry = $(SELECTORS.entry).first();
  const headword =
    cleanText(entry.find(SELECTORS.headword).first()) || payload.entryLabel?.trim() || normalizeWord(word);
  const idBase = payload.entryId ?? normalizeWord(word);
  const pronunciations = parsePronunciations($, entry);
  const badges = parseFrequencyBadges($, entry);
  const drafts = groupByPartOfSpeech($, entry.find(SELECTORS.homograph));

  // Collins can change its markup without notice, and the whole entry as plain text still shows the reader a definition.
  if (drafts.length === 0) {
    // Scoped to the entry and stripped of the playback markup, whose browser fallback line is not part of any definition.
    const plain = entry.clone();
    plain.find(SELECTORS.playbackControls).remove();
    const text = cleanText(plain);
    if (!text) return { headword, sections: [] };
    const sectionId = `${idBase}-1`;
    const sense: Sense = { id: `${sectionId}-1`, number: "1", definition: text, examples: [], labels: [] };
    return { headword, sections: [{ id: sectionId, title: headword, pronunciations, badges, senses: [sense] }] };
  }

  const sections: EntrySection[] = [];
  drafts.forEach((draft, index) => {
    const sectionId = `${idBase}-${index + 1}`;
    const senses: Sense[] = [];
    for (const element of draft.elements) senses.push(...parseHomograph($, element, sectionId, senses.length + 1));
    // A section with no sense would render as a blank pane, so it is dropped rather than shown.
    if (senses.length === 0) return;
    sections.push({
      id: sectionId,
      title: draft.partOfSpeech || headword,
      partOfSpeech: draft.partOfSpeech || undefined,
      pronunciations: [...pronunciations],
      badges: [...badges],
      senses,
    });
  });
  return { headword, sections };
}

function unavailable(reason: UnavailableReason, message: string): LookupResult {
  return { status: "unavailable", reason, message };
}

/**
 * The Collins Dictionary adapter, reading the entryContent markup the JSON search endpoints wrap.
 * Collins bills above a monthly call limit and forbids caching, so every lookup is charged and none is stored.
 */
export function createCollinsSource(http: Pick<HttpClient, "fetchText"> = httpClient): DictionarySource {
  // The entryUrl Collins returns points at the API itself, over http, so the browsable page is built here instead.
  // Collins spells a multi-word entry with hyphens, so "soup kitchen" must not become "soup%20kitchen".
  // The source is built before any key is read, so a link made outside a lookup falls back to the preference default.
  const entryUrl = (word: string, dictionary: CollinsDictionary = "english") =>
    `${SITE_BASE}/dictionary/${PUBLIC_DICTIONARY_PATHS[dictionary]}/` +
    encodeURIComponent(normalizeWord(word).replace(/\s+/g, "-"));

  function headersFor(credentials: CollinsCredentials): Record<string, string> {
    return { accessKey: credentials.apiKey, Accept: "application/json" };
  }

  /**
   * One retry when the host turns the request away rather than Collins answering it.
   * A turned-away request never reaches Collins, so retrying costs nothing against the monthly allowance,
   * and the refusal comes in bursts that clear within a second.
   */
  async function fetchWithRetry(url: string, credentials: CollinsCredentials) {
    let response = await http.fetchText(url, headersFor(credentials));
    for (const pause of CHALLENGE_RETRY_DELAYS_MS) {
      if (!turnedAway(response)) break;
      await delay(pause);
      response = await http.fetchText(url, headersFor(credentials));
    }
    return response;
  }

  async function suggestionsFor(word: string, credentials: CollinsCredentials): Promise<string[]> {
    const url =
      `${API_BASE}/${credentials.dictionary}/search/didyoumean` +
      `?q=${encodeURIComponent(normalizeWord(word))}&entrynumber=${SUGGESTION_COUNT}`;
    try {
      const response = await fetchWithRetry(url, credentials);
      if (response.status !== 200) return [];
      return parseJson(suggestionsSchema, response.body)?.suggestions ?? [];
    } catch {
      return [];
    }
  }

  async function lookup(word: string, options: LookupOptions): Promise<LookupResult> {
    const credentials = options.collins;
    if (!credentials) return unavailable("missing-key", MISSING_KEY_MESSAGE);

    const url =
      `${API_BASE}/${credentials.dictionary}/search/first` +
      `?q=${encodeURIComponent(normalizeWord(word))}&format=html`;
    let response;
    try {
      response = await fetchWithRetry(url, credentials);
    } catch (error) {
      if (error instanceof NetworkError) {
        return unavailable("network", error.timedOut ? "Collins timed out." : "Could not reach Collins.");
      }
      throw error;
    }

    if (response.status === 401 || response.status === 403) {
      // A challenge page shares the 403 Collins uses for a bad key, so blaming the key would send the reader to fix
      // something that is not broken.
      if (isBotWall(response.contentType)) return unavailable("blocked", BOT_WALL_MESSAGE);
      return unavailable("rejected-key", REJECTED_KEY_MESSAGE);
    }
    if (response.status === 429) {
      return unavailable("blocked", `Collins refused the request (HTTP ${response.status}).`);
    }
    // Collins answers a word it does not hold with 404, and reports its own exceptions as 5xx.
    if (response.status === 404) return { status: "not-found", suggestions: await suggestionsFor(word, credentials) };
    // An outage is not a miss: naming it "no entry" would hide it and spend a second billed call on spellings.
    // UnavailableReason has no value for a failure on the source's side, so "network" stands in because it offers Retry.
    if (response.status !== 200) {
      const reason = serverReason(response.body);
      return unavailable("network", `Collins could not answer (HTTP ${response.status}).${reason ? ` ${reason}` : ""}`);
    }

    const payload = parseJson(entrySchema, response.body);
    if (!payload) return unavailable("format-changed", "Collins answered with something other than an entry.");

    const parsed = parseEntry(payload, word);
    // Collins found the word but printed nothing readable, so a second call for spellings would buy nothing.
    if (parsed.sections.length === 0) return { status: "not-found", suggestions: [] };

    return {
      status: "found",
      entry: {
        source: "collins",
        headword: parsed.headword,
        url: entryUrl(parsed.headword, credentials.dictionary),
        sections: parsed.sections,
        attribution: ATTRIBUTION,
      },
    };
  }

  return {
    id: "collins",
    title: "Collins Dictionary",
    shortTitle: "Collins",
    homepage: SITE_BASE,
    requiresApiKey: "collins",
    cachingForbidden: true,
    entryUrl,
    lookup,
  };
}
