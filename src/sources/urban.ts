import { z } from "zod";
import { httpClient, NetworkError } from "../http/client";
import type { HttpClient } from "../http/client";
import type { EntrySection, LookupResult, Pronunciation, Sense } from "../model/entry";
import type { DictionarySource, LookupOptions } from "./types";

const SITE_BASE = "https://www.urbandictionary.com";
const API_BASE = "https://api.urbandictionary.com/v0";

/** One crowd-written definition as the open v0 endpoint returns it. */
const definitionSchema = z.object({
  defid: z.number(),
  word: z.string(),
  definition: z.string(),
  example: z.string(),
  author: z.string(),
  written_on: z.string(),
  thumbs_up: z.number(),
  thumbs_down: z.number(),
  // The live payload sends null for a term with no clip and a string otherwise; the key is always present.
  play_sound_url: z.string().nullable().optional(),
});

/** The list itself must be readable; one malformed definition is dropped rather than failing the lookup. */
const defineSchema = z.object({ list: z.array(z.unknown()) }).transform(({ list }) =>
  list.flatMap((item) => {
    const parsed = definitionSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  }),
);

/** The cheap autocomplete sibling answers with a bare array of terms. */
const autocompleteSchema = z.array(z.string());

type Definition = z.infer<typeof definitionSchema>;

function searchTerm(word: string): string {
  return word.trim();
}

/** Turns the [bracket] autolink markup into plain words and collapses CRLF to a single newline. */
function cleanText(text: string): string {
  return text
    .replace(/\[([^[\]]*)\]/g, "$1")
    .replace(/\r\n/g, "\n")
    .trim();
}

function parseJson<T>(schema: z.ZodType<T>, body: string): T | undefined {
  try {
    return schema.parse(JSON.parse(body));
  } catch {
    return undefined;
  }
}

function parseSense(definition: Definition, index: number): Sense {
  const example = cleanText(definition.example);
  const writtenOn = definition.written_on.slice(0, 10);
  return {
    id: String(definition.defid),
    number: String(index + 1),
    definition: cleanText(definition.definition),
    examples: example ? [example] : [],
    labels: [{ kind: "votes", text: `${definition.thumbs_up} up · ${definition.thumbs_down} down` }],
    note: `by ${definition.author.trim()}, ${writtenOn}`,
  };
}

/**
 * The clip is machine-generated speech behind a signed URL that is re-minted on every call.
 * It is read from the response and never persisted or rebuilt from the word.
 */
function parsePronunciations(first: Definition): Pronunciation[] {
  if (!first.play_sound_url) return [];
  return [{ variant: "us", audioUrl: first.play_sound_url, synthesized: true }];
}

function parseSection(list: Definition[]): EntrySection {
  return {
    id: "definitions",
    title: "Definitions",
    pronunciations: parsePronunciations(list[0]),
    badges: [],
    senses: list.map(parseSense),
  };
}

function unavailable(reason: "network" | "blocked" | "format-changed", message: string): LookupResult {
  return { status: "unavailable", reason, message };
}

/**
 * Urban Dictionary through the open v0 JSON endpoints.
 * A miss is HTTP 200 with an empty list, and HEAD is answered with 405, so only GET is ever sent.
 */
export function createUrbanDictionarySource(http: Pick<HttpClient, "fetchText"> = httpClient): DictionarySource {
  const entryUrl = (word: string) => `${SITE_BASE}/define.php?term=${encodeURIComponent(searchTerm(word))}`;

  async function suggestionsFor(word: string, options: LookupOptions): Promise<string[]> {
    try {
      const url = `${API_BASE}/autocomplete?term=${encodeURIComponent(searchTerm(word))}`;
      const response = await http.fetchText(url, { signal: options.signal });
      if (response.status !== 200) return [];
      return parseJson(autocompleteSchema, response.body) ?? [];
    } catch {
      return [];
    }
  }

  async function lookup(word: string, options: LookupOptions): Promise<LookupResult> {
    let response;
    try {
      // TODO(urban-paging): v0/define answers with the first ten definitions only; paging through &page=N is deferred.
      const url = `${API_BASE}/define?term=${encodeURIComponent(searchTerm(word))}`;
      response = await http.fetchText(url, { signal: options.signal });
    } catch (error) {
      if (error instanceof NetworkError) return unavailable("network", error.message);
      throw error;
    }
    if (response.status === 403 || response.status === 429) {
      return unavailable("blocked", `Urban Dictionary refused the request (HTTP ${response.status})`);
    }
    if (response.status !== 200) return unavailable("network", `Urban Dictionary answered HTTP ${response.status}`);

    const payload = parseJson(defineSchema, response.body);
    if (!payload) return unavailable("format-changed", "The entry loaded but could not be read.");
    if (payload.length === 0) return { status: "not-found", suggestions: await suggestionsFor(word, options) };

    // The stored headword carries the site's own casing, which the permalink also uses.
    const headword = payload[0].word;
    return {
      status: "found",
      entry: { source: "urban", headword, url: entryUrl(headword), sections: [parseSection(payload)] },
    };
  }

  return {
    id: "urban",
    title: "Urban Dictionary",
    shortTitle: "Urban",
    homepage: SITE_BASE,
    entryUrl,
    lookup,
  };
}
