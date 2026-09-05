import { describe, expect, it } from "vitest";
import { createLookupRunner } from "../lookup";
import type { LookupResult } from "../model/entry";
import { allSources, findSource } from "./index";
import type { MerriamWebsterCredentials } from "./types";

/**
 * Live integration check against today's pages; skipped unless LIVE_SOURCES=1 so the unit suite stays offline.
 * Run: LIVE_SOURCES=1 npx vitest run src/sources/live.test.ts
 */
const merriamWebster: MerriamWebsterCredentials | undefined = process.env.MW_API_KEY
  ? { apiKey: process.env.MW_API_KEY, reference: "collegiate" }
  : undefined;

function expectFound(result: LookupResult) {
  if (result.status !== "found") throw new Error(`expected found, got ${JSON.stringify(result)}`);
  return result.entry;
}

describe.skipIf(!process.env.LIVE_SOURCES)("allSources against the live sites", () => {
  const runner = createLookupRunner();

  for (const source of allSources) {
    it(`should return a kitchen entry with senses and a pronunciation from ${source.title}`, async () => {
      if (source.requiresApiKey && !merriamWebster) return;
      const entry = expectFound(await runner.lookup(source, "kitchen", { merriamWebster }));
      expect(entry.headword.toLowerCase()).toBe("kitchen");
      expect(entry.sections.length).toBeGreaterThan(0);
      expect(entry.sections.flatMap((section) => section.senses).length).toBeGreaterThan(0);
      expect(entry.sections[0].pronunciations.some((pronunciation) => pronunciation.audioUrl)).toBe(true);
    }, 30_000);
  }

  it("should report a miss for a nonsense word on every source", async () => {
    for (const source of allSources) {
      if (source.requiresApiKey && !merriamWebster) continue;
      const result = await runner.lookup(source, "zzzqqqnotaword", { merriamWebster });
      expect(result.status, source.id).toBe("not-found");
    }
  }, 60_000);

  it("should carry a picture for an illustrated word on the sources that publish pictures", async () => {
    const illustrated = { "oxford-learners": "kitchen", cambridge: "kitchen", longman: "guitar" } as const;
    for (const [id, word] of Object.entries(illustrated)) {
      const source = findSource(allSources, id as keyof typeof illustrated);
      if (!source) continue;
      const entry = expectFound(await runner.lookup(source, word, {}));
      const pictures = entry.sections.flatMap((section) => [
        section.picture,
        ...section.senses.map((sense) => sense.picture),
      ]);
      expect(pictures.some(Boolean), id).toBe(true);
    }
  }, 60_000);
});
