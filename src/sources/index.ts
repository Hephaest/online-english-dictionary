import type { SourceId } from "../model/entry";
import type { AppPreferences } from "../preferences";
import { createCambridgeSource } from "./cambridge";
import { createCollinsSource } from "./collins";
import { createLongmanSource } from "./longman";
import { createMerriamWebsterSource } from "./merriam-webster";
import { createOxfordLearnersSource } from "./oxford-learners";
import { createUrbanDictionarySource } from "./urban";
import type { DictionarySource } from "./types";

/** Dropdown order. */
export const allSources: DictionarySource[] = [
  createCambridgeSource(),
  createLongmanSource(),
  createOxfordLearnersSource(),
  createCollinsSource(),
  createMerriamWebsterSource(),
  createUrbanDictionarySource(),
];

/** Sources the user can use right now: a source that needs a key is hidden until the key is entered. */
export function availableSources(preferences: Pick<AppPreferences, "merriamWebster" | "collins">): DictionarySource[] {
  return allSources.filter((source) => !source.requiresApiKey || Boolean(preferences[source.requiresApiKey]));
}

export function findSource(sources: DictionarySource[], id: SourceId | undefined): DictionarySource | undefined {
  return sources.find((source) => source.id === id);
}

export function resolveSource(
  sources: DictionarySource[],
  ...candidates: Array<SourceId | undefined>
): DictionarySource {
  for (const candidate of candidates) {
    const source = findSource(sources, candidate);
    if (source) return source;
  }
  return sources[0];
}

/** The source after (step 1) or before (step -1) the current one, wrapping around. */
export function neighborSource(sources: DictionarySource[], currentId: SourceId, step: 1 | -1): DictionarySource {
  const index = sources.findIndex((source) => source.id === currentId);
  const nextIndex = (index + step + sources.length) % sources.length;
  return sources[nextIndex];
}

/** OED itself is login-gated, so the only integration is a search link. */
export function oedSearchUrl(word: string): string {
  return `https://www.oed.com/search/dictionary/?scope=Entries&q=${encodeURIComponent(word)}`;
}
