import { usePromise } from "@raycast/utils";
import { useRef } from "react";
import { NetworkError } from "../http/client";
import { lookupRunner, normalizeWord } from "../lookup";
import type { LookupResult, SourceId } from "../model/entry";
import type { DictionarySource, MerriamWebsterCredentials } from "../sources/types";

export interface LookupState {
  result: LookupResult | undefined;
  /** The source and word the result belongs to; they lag behind the arguments while a new lookup loads. */
  resultSourceId: SourceId | undefined;
  resultWord: string | undefined;
  isLoading: boolean;
  /** Drops the cached result and fetches again. */
  refresh: () => void;
}

interface Loaded {
  sourceId: SourceId;
  word: string;
  result: LookupResult;
}

/** Anything an adapter throws becomes a result the screens can render, so no error path leaves a blank list. */
function resultFromError(error: unknown): LookupResult {
  if (error instanceof NetworkError) return { status: "unavailable", reason: "network", message: error.message };
  const message = error instanceof Error ? error.message : String(error);
  return { status: "unavailable", reason: "format-changed", message: `The entry could not be read: ${message}` };
}

export function useLookup(
  source: DictionarySource | undefined,
  word: string,
  merriamWebster: MerriamWebsterCredentials | undefined,
): LookupState {
  const abortable = useRef<AbortController | null>(null);
  const normalized = normalizeWord(word);
  const { data, isLoading, revalidate } = usePromise(
    async (sourceId: SourceId | undefined, lookupWord: string): Promise<Loaded | undefined> => {
      if (!source || source.id !== sourceId || !lookupWord) return undefined;
      try {
        const result = await lookupRunner.lookup(source, lookupWord, {
          signal: abortable.current?.signal,
          merriamWebster,
        });
        return { sourceId, word: lookupWord, result };
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        return { sourceId, word: lookupWord, result: resultFromError(error) };
      }
    },
    [source?.id, normalized],
    { abortable, execute: Boolean(source && normalized) },
  );
  return {
    result: data?.result,
    resultSourceId: data?.sourceId,
    resultWord: data?.word,
    isLoading,
    refresh: () => {
      if (source) lookupRunner.forget(source.id, normalized);
      revalidate();
    },
  };
}
