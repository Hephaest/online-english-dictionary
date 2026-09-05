import { describe, expect, it } from "vitest";
import { createLookupRunner, normalizeWord } from "./lookup";
import type { LookupResult } from "./model/entry";
import type { DictionarySource } from "./sources/types";

function sourceReturning(results: LookupResult[]): { source: DictionarySource; calls: string[] } {
  const calls: string[] = [];
  const queue = [...results];
  const source: DictionarySource = {
    id: "oxford-learners",
    title: "Oxford Learner's Dictionaries",
    shortTitle: "Oxford Learner's",
    homepage: "https://example.test",
    entryUrl: (word) => `https://example.test/${word}`,
    async lookup(word) {
      calls.push(word);
      return queue.shift() ?? { status: "not-found", suggestions: [] };
    },
  };
  return { source, calls };
}

const found: LookupResult = {
  status: "found",
  entry: { source: "oxford-learners", headword: "kitchen", url: "https://example.test/kitchen", sections: [] },
};

describe("normalizeWord", () => {
  it("should trim, collapse inner spaces, and lowercase the word", () => {
    expect(normalizeWord("  Give   Up ")).toBe("give up");
  });
});

describe("createLookupRunner", () => {
  it("should ask the source with the normalized word", async () => {
    const { source, calls } = sourceReturning([found]);
    await createLookupRunner().lookup(source, "  Kitchen ", {});
    expect(calls).toEqual(["kitchen"]);
  });

  it("should answer repeated lookups of the same word from memory", async () => {
    const { source, calls } = sourceReturning([found]);
    const runner = createLookupRunner();
    await runner.lookup(source, "kitchen", {});
    await runner.lookup(source, "Kitchen", {});
    expect(calls).toHaveLength(1);
  });

  it("should share one request between callers that ask while it is in flight", async () => {
    const { source, calls } = sourceReturning([found]);
    const runner = createLookupRunner();
    await Promise.all([runner.lookup(source, "kitchen", {}), runner.lookup(source, "kitchen", {})]);
    expect(calls).toHaveLength(1);
  });

  it("should retry after a failure instead of remembering it", async () => {
    const failure: LookupResult = { status: "unavailable", reason: "network", message: "offline" };
    const { source, calls } = sourceReturning([failure, found]);
    const runner = createLookupRunner();
    await expect(runner.lookup(source, "kitchen", {})).resolves.toEqual(failure);
    await expect(runner.lookup(source, "kitchen", {})).resolves.toEqual(found);
    expect(calls).toHaveLength(2);
  });

  it("should refetch after a word is forgotten", async () => {
    const { source, calls } = sourceReturning([found, found]);
    const runner = createLookupRunner();
    await runner.lookup(source, "kitchen", {});
    runner.forget("oxford-learners", "kitchen");
    await runner.lookup(source, "kitchen", {});
    expect(calls).toHaveLength(2);
  });
});
