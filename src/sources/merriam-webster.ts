import { httpClient, NetworkError } from "../http/client";
import type { HttpClient } from "../http/client";
import type {
  Badge,
  EntrySection,
  LookupResult,
  Picture,
  Pronunciation,
  Sense,
  UnavailableReason,
} from "../model/entry";
import type { DictionarySource, LookupOptions, MerriamWebsterCredentials } from "./types";

const SITE_BASE = "https://www.merriam-webster.com";
const API_BASE = "https://www.dictionaryapi.com/api/v3/references";
const AUDIO_BASE = "https://media.merriam-webster.com/audio/prons/en/us/mp3";
const ART_BASE = `${SITE_BASE}/assets/mw/static/art/dict`;

const MISSING_KEY_MESSAGE =
  "Merriam-Webster needs a free key from dictionaryapi.com. Paste it into the Merriam-Webster API Key preference.";
const REJECTED_KEY_MESSAGE =
  "Merriam-Webster refused the key. Check the Merriam-Webster API Key preference, and make sure the Merriam-Webster Dictionary preference names the reference the key is subscribed to.";

/** Tags that wrap text and carry no content of their own. */
const PAIRED_TAGS = [
  "it",
  "wi",
  "b",
  "sc",
  "inf",
  "sup",
  "phrase",
  "qword",
  "parahw",
  "gloss",
  "dx",
  "dx_def",
  "dx_ety",
  "ma",
];

/** Tags whose first pipe-separated field is the word to show. */
const LINK_TAGS = ["sx", "d_link", "a_link", "i_link", "dxt", "et_link", "mat"];

const PAIRED_TAG_PATTERN = new RegExp(`\\{/?(?:${PAIRED_TAGS.join("|")})\\}`, "g");
const LINK_TAG_PATTERN = new RegExp(`\\{(?:${LINK_TAGS.join("|")})\\|([^|}]*)[^}]*\\}`, "g");

/**
 * Rewrites one Merriam-Webster formatting string as plain text.
 * Unknown tokens are dropped rather than shown, so no raw braces reach the UI.
 */
export function stripFormattingTokens(text: string): string {
  return text
    .replace(PAIRED_TAG_PATTERN, "")
    .replace(LINK_TAG_PATTERN, "$1")
    .replace(/\{bc\}/g, ": ")
    .replace(/\{ldquo\}/g, "“")
    .replace(/\{rdquo\}/g, "”")
    .replace(/\{p_br\}/g, "\n")
    .replace(/\{[^}]*\}/g, "")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/ +:/g, ":")
    .replace(/^\s*:\s*/, "")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** A Merriam-Webster sequence element: a kind tag and its payload. */
type TaggedPair = [string, unknown];

function isTaggedPair(value: unknown): value is TaggedPair {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === "string";
}

function normalizeWord(word: string): string {
  return word.trim().toLowerCase();
}

/** The printed headword: hwi.hw carries asterisks that mark syllable breaks. */
function headwordOf(entry: Record<string, unknown>): string | undefined {
  const hwi = isRecord(entry.hwi) ? entry.hwi : undefined;
  return stringOf(hwi?.hw)?.replace(/\*/g, "");
}

/** The documented subdirectory rule for the pronunciation audio CDN. */
function audioSubdirectory(audio: string): string {
  if (audio.startsWith("bix")) return "bix";
  if (audio.startsWith("gg")) return "gg";
  if (!/^[A-Za-z]/.test(audio)) return "number";
  return audio[0];
}

function parsePronunciations(entry: Record<string, unknown>): Pronunciation[] {
  const hwi = isRecord(entry.hwi) ? entry.hwi : undefined;
  const first = asArray(hwi?.prs)[0];
  if (!isRecord(first)) return [];
  const ipa = stringOf(first.ipa);
  const respelling = stringOf(first.mw);
  const text = ipa ?? respelling;
  const audio = isRecord(first.sound) ? stringOf(first.sound.audio) : undefined;
  if (!text && !audio) return [];
  return [
    {
      variant: "us",
      text,
      notation: text ? (ipa ? "ipa" : "respelling") : undefined,
      audioUrl: audio ? `${AUDIO_BASE}/${audioSubdirectory(audio)}/${encodeURIComponent(audio)}.mp3` : undefined,
    },
  ];
}

function parsePicture(entry: Record<string, unknown>): Picture | undefined {
  const art = isRecord(entry.art) ? entry.art : undefined;
  const artid = stringOf(art?.artid);
  if (!artid) return undefined;
  const caption = stringOf(art?.capt);
  return {
    thumbUrl: `${ART_BASE}/${encodeURIComponent(artid)}.gif`,
    caption: caption ? stripFormattingTokens(caption) : undefined,
  };
}

function definitionText(dt: unknown): string {
  const texts = asArray(dt)
    .filter(isTaggedPair)
    .filter(([kind]) => kind === "text")
    .map(([, value]) => stringOf(value) ?? "");
  return stripFormattingTokens(texts.join(" "));
}

function exampleTexts(dt: unknown): string[] {
  const examples: string[] = [];
  for (const item of asArray(dt)) {
    if (!isTaggedPair(item)) continue;
    // A usage note nests dt-shaped groups of its own, and the examples inside them belong to the sense.
    if (item[0] === "uns") {
      for (const group of asArray(item[1])) examples.push(...exampleTexts(group));
      continue;
    }
    if (item[0] !== "vis") continue;
    for (const example of asArray(item[1])) {
      if (!isRecord(example)) continue;
      const text = stringOf(example.t);
      if (text) examples.push(stripFormattingTokens(text));
    }
  }
  return examples;
}

/** What a dt-less ["sen", obj] header passes down to the senses it introduces. */
interface SenseHeading {
  number?: string;
  labels: Badge[];
}

/** One sense object plus the heading it was printed under. */
interface CollectedSense {
  sense: Record<string, unknown>;
  heading: SenseHeading;
}

/** A ["sen", obj] with no definition of its own is a heading for the senses that follow it. */
function isSenseHeading(kind: string, payload: Record<string, unknown>): boolean {
  return kind === "sen" && !payload.dt && !payload.sdsense;
}

function headingOf(payload: Record<string, unknown>, parent: SenseHeading): SenseHeading {
  const number = [parent.number, stringOf(payload.sn)].filter(Boolean).join(" ");
  return { number: number || undefined, labels: [...parent.labels, ...senseLabels(payload)] };
}

/**
 * Flattens def[].sseq into the sense objects it nests.
 * The sequence mixes ["sense", obj], ["sen", obj], ["bs", { sense }] and ["pseq", [pairs]] at any depth.
 */
function collectSenses(node: unknown, heading: SenseHeading, collected: CollectedSense[]): void {
  if (!Array.isArray(node)) return;
  if (isTaggedPair(node)) {
    const [kind, payload] = node;
    if ((kind === "sense" || kind === "sen") && isRecord(payload)) collected.push({ sense: payload, heading });
    else if (kind === "bs" && isRecord(payload)) collectSenses(["sense", payload.sense], heading, collected);
    else if (kind === "pseq") for (const item of asArray(payload)) collectSenses(item, heading, collected);
    return;
  }
  // A heading applies to the element that follows it, which is the pseq holding its sub-senses.
  let pending: SenseHeading | undefined;
  for (const item of node) {
    if (isTaggedPair(item) && isRecord(item[1]) && isSenseHeading(item[0], item[1])) {
      pending = headingOf(item[1], heading);
      continue;
    }
    collectSenses(item, pending ?? heading, collected);
    pending = undefined;
  }
}

/** Merriam-Webster prints a divided sense as a continuation of the sense above it, under the same number. */
function withDividedSense(definition: string, examples: string[], sdsense: unknown): [string, string[]] {
  if (!isRecord(sdsense)) return [definition, examples];
  const dividedText = definitionText(sdsense.dt);
  if (!dividedText) return [definition, examples];
  const marker = stringOf(sdsense.sd);
  const divided = marker ? `${marker}: ${dividedText}` : dividedText;
  return [definition ? `${definition} ${divided}` : divided, [...examples, ...exampleTexts(sdsense.dt)]];
}

function senseLabels(sense: Record<string, unknown>): Badge[] {
  const labels: Badge[] = [];
  for (const label of asArray(sense.sls)) {
    const text = stringOf(label);
    if (text) labels.push({ kind: "label", text });
  }
  return labels;
}

/** An inflected form such as ran carries its whole meaning in cxs and has no def block at all. */
function crossReferenceText(block: Record<string, unknown>): string {
  const targets = asArray(block.cxtis)
    .filter(isRecord)
    .map((target) => [stringOf(target.cxl), stringOf(target.cxt)].filter(Boolean).join(" "))
    .filter(Boolean);
  const text = [stringOf(block.cxl), targets.join(", ")].filter(Boolean).join(" ");
  return stripFormattingTokens(text);
}

function parseSection(entry: Record<string, unknown>, headword: string, sectionId: string): EntrySection {
  const partOfSpeech = stringOf(entry.fl);
  const homograph = typeof entry.hom === "number" ? String(entry.hom) : stringOf(entry.hom);
  const title = [partOfSpeech ?? headword, homograph].filter(Boolean).join(" ");
  const senses: Sense[] = [];

  for (const block of asArray(entry.def)) {
    if (!isRecord(block)) continue;
    const verbDivider = stringOf(block.vd);
    const blockLabels: Badge[] = verbDivider ? [{ kind: "grammar", text: verbDivider }] : [];
    const collected: CollectedSense[] = [];
    collectSenses(block.sseq, { labels: [] }, collected);
    for (const { sense, heading } of collected) {
      const [definition, examples] = withDividedSense(definitionText(sense.dt), exampleTexts(sense.dt), sense.sdsense);
      if (!definition) continue;
      const number = [heading.number, stringOf(sense.sn)].filter(Boolean).join(" ");
      senses.push({
        id: `${sectionId}-${senses.length + 1}`,
        number: number || String(senses.length + 1),
        definition,
        examples,
        labels: [...blockLabels, ...heading.labels, ...senseLabels(sense)],
      });
    }
  }

  for (const block of asArray(entry.cxs)) {
    if (!isRecord(block)) continue;
    const definition = crossReferenceText(block);
    if (!definition) continue;
    senses.push({
      id: `${sectionId}-${senses.length + 1}`,
      number: String(senses.length + 1),
      definition,
      examples: [],
      labels: [],
    });
  }

  return {
    id: sectionId,
    title,
    partOfSpeech,
    pronunciations: parsePronunciations(entry),
    badges: [],
    senses,
    picture: parsePicture(entry),
  };
}

function unavailable(reason: UnavailableReason, message: string): LookupResult {
  return { status: "unavailable", reason, message };
}

export function createMerriamWebsterSource(http: Pick<HttpClient, "fetchText"> = httpClient): DictionarySource {
  const entryUrl = (word: string) => `${SITE_BASE}/dictionary/${encodeURIComponent(normalizeWord(word))}`;

  function apiUrl(word: string, credentials: MerriamWebsterCredentials): string {
    const path = `${API_BASE}/${credentials.reference}/json/${encodeURIComponent(normalizeWord(word))}`;
    return `${path}?key=${encodeURIComponent(credentials.apiKey)}`;
  }

  async function lookup(word: string, options: LookupOptions): Promise<LookupResult> {
    const credentials = options.merriamWebster;
    if (!credentials) return unavailable("missing-key", MISSING_KEY_MESSAGE);

    let response;
    try {
      response = await http.fetchText(apiUrl(word, credentials));
    } catch (error) {
      // The request URL carries the key, so nothing derived from it may reach a user-visible message.
      if (error instanceof NetworkError) {
        return unavailable(
          "network",
          error.timedOut ? "Merriam-Webster timed out." : "Could not reach Merriam-Webster.",
        );
      }
      throw error;
    }
    if (response.status === 403 || response.status === 429) {
      return unavailable("blocked", `Merriam-Webster refused the request (HTTP ${response.status}).`);
    }
    if (response.status !== 200) return unavailable("network", `Merriam-Webster answered HTTP ${response.status}.`);

    // The API answers HTTP 200 for everything; verified 2026-09-05, a key problem comes back as text/plain.
    if (response.contentType.includes("text/plain")) return unavailable("rejected-key", REJECTED_KEY_MESSAGE);

    let payload: unknown;
    try {
      payload = JSON.parse(response.body);
    } catch {
      return unavailable("format-changed", "Merriam-Webster answered with something that is not JSON.");
    }
    if (!Array.isArray(payload))
      return unavailable("format-changed", "Merriam-Webster answered with an unknown shape.");
    if (payload.length === 0) return { status: "not-found", suggestions: [] };
    if (payload.every((item) => typeof item === "string")) {
      return { status: "not-found", suggestions: payload as string[] };
    }

    const entries = payload.filter(isRecord);
    if (entries.length === 0) return unavailable("format-changed", "Merriam-Webster answered with an unknown shape.");

    // The API also answers with compounds and derived forms, such as kitchen cabinet for kitchen.
    const headwords = [...new Set(entries.map(headwordOf).filter((headword): headword is string => !!headword))];
    if (headwords.length === 0) {
      return unavailable("format-changed", "Merriam-Webster answered with entries that carry no headword.");
    }
    const query = normalizeWord(word);
    const matches = entries.filter((entry) => headwordOf(entry)?.toLowerCase() === query);
    if (matches.length === 0) return { status: "not-found", suggestions: headwords };

    const headword = headwordOf(matches[0]) ?? word.trim();
    const sections = matches
      .map((entry, index) => {
        const meta = isRecord(entry.meta) ? entry.meta : undefined;
        return parseSection(entry, headword, stringOf(meta?.id) ?? `${query}-${index + 1}`);
      })
      // A section with no sense would render as a blank pane, so the word counts as a miss instead.
      .filter((section) => section.senses.length > 0);
    if (sections.length === 0) {
      return { status: "not-found", suggestions: headwords.filter((candidate) => candidate.toLowerCase() !== query) };
    }
    return {
      status: "found",
      entry: { source: "merriam-webster", headword, url: entryUrl(headword), sections },
    };
  }

  return {
    id: "merriam-webster",
    title: "Merriam-Webster",
    shortTitle: "Merriam-Webster",
    homepage: SITE_BASE,
    requiresApiKey: "merriamWebster",
    entryUrl,
    lookup,
  };
}
