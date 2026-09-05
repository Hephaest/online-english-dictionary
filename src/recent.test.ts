import { beforeEach, describe, expect, it, vi } from "vitest";
import { SOURCE_IDS } from "./model/entry";
import { forgetLookup, listRecent, RECENT_LIMIT, rememberLookup } from "./recent";

// The shared @raycast/api stub exports LocalStorage as undefined; recent.ts is the one module that calls it.
const { store } = vi.hoisted(() => ({ store: new Map<string, string>() }));

vi.mock("@raycast/api", () => ({
  LocalStorage: {
    getItem: async (key: string) => store.get(key),
    setItem: async (key: string, value: string) => void store.set(key, value),
  },
}));

/** The raw bytes on disk, read without naming the storage key, so the test stays black-box. */
function storedRows(): Record<string, unknown>[] {
  const [raw] = [...store.values()];
  return raw ? JSON.parse(raw) : [];
}

beforeEach(() => store.clear());

describe("what a remembered lookup puts on disk", () => {
  it("should store only the reader's word, the dictionary, and the time", async () => {
    await rememberLookup({ word: "serendipity", source: "cambridge" });

    const [row] = storedRows();
    expect(Object.keys(row).sort()).toEqual(["lookedUpAt", "source", "word"]);
    expect(row.word).toBe("serendipity");
    expect(row.source).toBe("cambridge");
  });

  it("should never write a part of speech, because that is the dictionary's own data", async () => {
    await rememberLookup({ word: "run", source: "merriam-webster" });

    expect(JSON.stringify(storedRows())).not.toContain("partOfSpeech");
  });
});

describe("rows written by an older version", () => {
  it("should still load, dropping the fields that are no longer kept", async () => {
    store.set(
      "recent-lookups",
      JSON.stringify([
        { word: "run", source: "merriam-webster", partOfSpeech: "verb", lookedUpAt: "2026-09-05T00:00:00.000Z" },
      ]),
    );

    const [row] = await listRecent();
    expect(row.word).toBe("run");
    expect(Object.keys(row).sort()).toEqual(["lookedUpAt", "source", "word"]);
  });

  it("should be dropped when they no longer match the stored shape", async () => {
    store.set("recent-lookups", JSON.stringify([{ word: "", source: "cambridge", lookedUpAt: "2026-09-05" }]));

    expect(await listRecent()).toEqual([]);
  });
});

describe("the recent list itself", () => {
  it("should keep one row when the same word is looked up twice in the same dictionary", async () => {
    await rememberLookup({ word: "kitchen", source: "longman" });
    await rememberLookup({ word: "kitchen", source: "longman" });

    expect(await listRecent()).toHaveLength(1);
  });

  it("should keep a row per dictionary for the same word", async () => {
    await rememberLookup({ word: "kitchen", source: "longman" });
    await rememberLookup({ word: "kitchen", source: "cambridge" });

    expect(await listRecent()).toHaveLength(2);
  });

  it("should show the newest lookup first", async () => {
    await rememberLookup({ word: "first", source: "cambridge" });
    await rememberLookup({ word: "second", source: "cambridge" });

    expect((await listRecent()).map((row) => row.word)).toEqual(["second", "first"]);
  });

  it("should stop growing at the row limit", async () => {
    for (let index = 0; index <= RECENT_LIMIT; index += 1) {
      await rememberLookup({ word: `word-${index}`, source: "cambridge" });
    }

    expect(await listRecent()).toHaveLength(RECENT_LIMIT);
  });

  it("should forget a row the reader removes", async () => {
    await rememberLookup({ word: "kitchen", source: "longman" });
    await forgetLookup("kitchen", "longman");

    expect(await listRecent()).toEqual([]);
  });

  it("should keep a row for every dictionary the app defines, so a new one cannot vanish unnoticed", async () => {
    for (const source of SOURCE_IDS) {
      await rememberLookup({ word: `word-${source}`, source });
    }

    expect((await listRecent()).map((row) => row.source).sort()).toEqual([...SOURCE_IDS].sort());
  });
});
