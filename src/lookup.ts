/**
 * Runs lookups against a source with one in-memory cache per command session.
 * Entry content is never written to disk: Cambridge's terms forbid storing its content and Urban audio links expire.
 */
import type { LookupResult, SourceId } from "./model/entry";
import type { DictionarySource, LookupOptions } from "./sources/types";

export type LookupKey = `${SourceId}:${string}`;

export function normalizeWord(word: string): string {
  return word.trim().replace(/\s+/g, " ").toLowerCase();
}

export function lookupKey(sourceId: SourceId, word: string): LookupKey {
  return `${sourceId}:${normalizeWord(word)}`;
}

export interface LookupRunner {
  lookup(source: DictionarySource, word: string, options: LookupOptions): Promise<LookupResult>;
  /** Drops one cached result so the next lookup refetches. */
  forget(sourceId: SourceId, word: string): void;
}

export function createLookupRunner(): LookupRunner {
  const results = new Map<LookupKey, LookupResult>();
  const inFlight = new Map<LookupKey, Promise<LookupResult>>();

  async function lookup(source: DictionarySource, word: string, options: LookupOptions): Promise<LookupResult> {
    const key = lookupKey(source.id, word);
    const cached = results.get(key);
    if (cached) return cached;
    const pending = inFlight.get(key);
    if (pending) return pending;
    const request = source
      .lookup(normalizeWord(word), options)
      .then((result) => {
        // Failures are not cached so that Retry and source cycling always hit the network again.
        if (result.status !== "unavailable") results.set(key, result);
        return result;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, request);
    return request;
  }

  return {
    lookup,
    forget: (sourceId, word) => results.delete(lookupKey(sourceId, word)),
  };
}

/** One runner per extension process; Raycast unloads the process when the window closes, which empties the cache. */
export const lookupRunner = createLookupRunner();
