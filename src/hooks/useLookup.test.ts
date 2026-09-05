// @vitest-environment jsdom
// @raycast/api resolves to tests/stubs/raycast-api.ts here (vitest.config.mts), which is all usePromise needs.
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, useEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { LookupResult, SourceId } from "../model/entry";
import type { DictionarySource, LookupOptions } from "../sources/types";
import { lookupRunner } from "../lookup";
import { useLookup } from "./useLookup";

function foundEntry(id: SourceId, word: string): LookupResult {
  return { status: "found", entry: { source: id, headword: word, url: `https://example.test/${word}`, sections: [] } };
}

/**
 * A source that answers when the test says so. It honours an abort signal the way the real adapters do, answering an
 * aborted request with a network failure, so this file keeps failing if a caller signal is ever handed to the runner again.
 */
function deferredSource(id: SourceId) {
  const calls: string[] = [];
  let answer: ((result: LookupResult) => void) | undefined;
  const source: DictionarySource = {
    id,
    title: id,
    shortTitle: id,
    homepage: "https://example.test",
    entryUrl: (word) => `https://example.test/${word}`,
    lookup(word, options: LookupOptions & { signal?: AbortSignal }) {
      calls.push(word);
      return new Promise<LookupResult>((resolve) => {
        answer = resolve;
        options.signal?.addEventListener("abort", () =>
          resolve({ status: "unavailable", reason: "network", message: "aborted" }),
        );
      });
    },
  };
  return { source, calls, answer: (result: LookupResult) => answer?.(result) };
}

/** Counts how many times React mounted the calling component, which is two under StrictMode in development. */
function useMountCount(mounts: { count: number }) {
  useEffect(() => {
    mounts.count += 1;
  }, [mounts]);
}

describe("useLookup", () => {
  // Testing Library only auto-unmounts with global afterEach; the runner is process-wide, so its cache is cleared per case too.
  afterEach(() => {
    cleanup();
    lookupRunner.forget("cambridge", "kitchen");
    lookupRunner.forget("longman", "serendipity");
  });

  it("should resolve the entry once the source answers", async () => {
    const { source, answer } = deferredSource("cambridge");
    const { result } = renderHook(() => useLookup(source, "kitchen", undefined));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.result).toBeUndefined();

    answer(foundEntry("cambridge", "kitchen"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.result).toEqual(foundEntry("cambridge", "kitchen"));
    expect(result.current.resultSourceId).toBe("cambridge");
    expect(result.current.resultWord).toBe("kitchen");
  });

  it("should resolve the entry with one request when StrictMode mounts twice", async () => {
    const mounts = { count: 0 };
    const { source, calls, answer } = deferredSource("longman");
    // StrictMode must be the outermost element, as it is around a Raycast command: React double-invokes mount effects
    // only for a newly placed subtree whose root sits inside StrictMode, so a custom wrapper component would defeat it.
    const { result } = renderHook(
      () => {
        useMountCount(mounts);
        return useLookup(source, "serendipity", undefined);
      },
      { wrapper: StrictMode },
    );
    expect(mounts.count).toBe(2);

    answer(foundEntry("longman", "serendipity"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.result).toEqual(foundEntry("longman", "serendipity"));
    expect(calls).toEqual(["serendipity"]);
  });
});
