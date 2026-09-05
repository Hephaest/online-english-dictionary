import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NetworkError } from "../http/client";
import type { HttpClient } from "../http/client";
import { createOxfordLearnersSource } from "./oxford-learners";

const ENTRY = "https://www.oxfordlearnersdictionaries.com/definition/english/";

function fixture(name: string): string {
  return readFileSync(path.join(__dirname, "../../tests/fixtures/oxford-learners", `${name}.html`), "utf8");
}

function httpServing(routes: Record<string, { status: number; body: string }>): Pick<HttpClient, "fetchText"> {
  return {
    async fetchText(url) {
      const route = routes[url];
      if (!route) throw new NetworkError(url, new Error("no route"));
      return { status: route.status, url, contentType: "text/html", body: route.body };
    },
  };
}

async function lookupFound(word: string, routes: Record<string, { status: number; body: string }>) {
  const result = await createOxfordLearnersSource(httpServing(routes)).lookup(word, {});
  if (result.status !== "found") throw new Error(`expected found, got ${result.status}`);
  return result.entry;
}

describe("createOxfordLearnersSource", () => {
  describe("entry parsing", () => {
    const routes = { [`${ENTRY}kitchen`]: { status: 200, body: fixture("kitchen") } };

    it("should read the headword, part of speech, and learner badges", async () => {
      const entry = await lookupFound("kitchen", routes);
      expect(entry.headword).toBe("kitchen");
      expect(entry.url).toBe(`${ENTRY}kitchen`);
      expect(entry.sections[0].partOfSpeech).toBe("noun");
      expect(entry.sections[0].badges).toEqual([
        { kind: "cefr", text: "A1" },
        { kind: "label", text: "Oxford 3000" },
      ]);
    });

    it("should read US and UK pronunciation text and audio from the page, US first", async () => {
      const entry = await lookupFound("kitchen", routes);
      const [us, uk] = entry.sections[0].pronunciations;
      expect(us).toEqual({
        variant: "us",
        text: "ˈkɪtʃɪn",
        notation: "ipa",
        audioUrl: "https://www.oxfordlearnersdictionaries.com/media/english/us_pron/k/kit/kitch/kitchen__us_2.mp3",
      });
      expect(uk.variant).toBe("uk");
      expect(uk.audioUrl).toContain("/uk_pron/k/kit/kitch/kitchen__gb_2.mp3");
    });

    it("should attach the picture to the sense that carries it, with the full-size URL", async () => {
      const entry = await lookupFound("kitchen", routes);
      const [first] = entry.sections[0].senses;
      expect(first.picture).toEqual({
        thumbUrl: "https://www.oxfordlearnersdictionaries.com/media/english/thumb/k/kit/kitch/kitchen.png",
        fullUrl: "https://www.oxfordlearnersdictionaries.com/media/english/fullsize/k/kit/kitch/kitchen.png",
      });
    });

    it("should keep the definition, the primary examples, and the extra examples of a sense", async () => {
      const entry = await lookupFound("kitchen", routes);
      const first = entry.sections[0].senses[0];
      expect(first.definition).toBe("a room in which meals are cooked or prepared");
      expect(first.cefr).toBe("A1");
      expect(first.examples).toContain("We ate at the kitchen table.");
      expect(first.examples.length).toBeGreaterThan(3);
      expect(new Set(first.examples).size).toBe(first.examples.length);
    });

    it("should leave idiom senses out of the entry senses", async () => {
      const entry = await lookupFound("kitchen", routes);
      const senses = entry.sections.flatMap((section) => section.senses);
      expect(senses.map((sense) => sense.number)).toEqual(["1"]);
      expect(senses.some((sense) => sense.definition.includes("very large number of things"))).toBe(false);
    });
  });

  describe("entry without a picture", () => {
    it("should return one sense and no picture when the page has neither", async () => {
      const entry = await lookupFound("serendipity", {
        [`${ENTRY}serendipity`]: { status: 200, body: fixture("serendipity") },
      });
      expect(entry.sections).toHaveLength(1);
      expect(entry.sections[0].senses).toHaveLength(1);
      expect(entry.sections[0].senses[0].picture).toBeUndefined();
      expect(entry.sections[0].badges).toEqual([]);
    });
  });

  describe("homograph pages", () => {
    const routes = {
      [`${ENTRY}run`]: { status: 200, body: fixture("run_1") },
      [`${ENTRY}run_2`]: { status: 200, body: fixture("run_2") },
    };

    it("should fetch the other homograph pages and group senses by the page's own shortcut headings", async () => {
      const entry = await lookupFound("run", routes);
      const partsOfSpeech = new Set(entry.sections.map((section) => section.partOfSpeech));
      expect(partsOfSpeech).toEqual(new Set(["verb", "noun"]));
      expect(entry.sections[0].title).toBe("verb · move fast on foot");
      expect(entry.sections[0].senses[0].labels).toContainEqual({ kind: "grammar", text: "[intransitive]" });
    });

    it("should keep register labels such as (informal) on the sense they belong to", async () => {
      const entry = await lookupFound("run", routes);
      const sense = entry.sections
        .flatMap((section) => section.senses)
        .find((candidate) => candidate.definition.startsWith("to drive somebody to a place in a car"));
      expect(sense?.labels).toContainEqual({ kind: "register", text: "(informal)" });
    });

    it("should number senses continuously within one homograph", async () => {
      const entry = await lookupFound("run", routes);
      const verbSenses = entry.sections.filter((section) => section.partOfSpeech === "verb").flatMap((s) => s.senses);
      expect(verbSenses.map((sense) => sense.number)).toEqual(verbSenses.map((_, index) => String(index + 1)));
    });
  });

  describe("HTTP 404 miss", () => {
    it("should report not found without inventing suggestions when the site answers 404", async () => {
      const source = createOxfordLearnersSource(
        httpServing({ [`${ENTRY}zzzqqqnotaword`]: { status: 404, body: fixture("miss") } }),
      );
      await expect(source.lookup("zzzqqqnotaword", {})).resolves.toEqual({ status: "not-found", suggestions: [] });
    });
  });

  describe("unavailable responses", () => {
    it("should report a blocked request when the site answers HTTP 403", async () => {
      const source = createOxfordLearnersSource(httpServing({ [`${ENTRY}kitchen`]: { status: 403, body: "" } }));
      await expect(source.lookup("kitchen", {})).resolves.toMatchObject({ status: "unavailable", reason: "blocked" });
    });

    it("should report a network failure when the request never completes", async () => {
      const source = createOxfordLearnersSource(httpServing({}));
      await expect(source.lookup("kitchen", {})).resolves.toMatchObject({ status: "unavailable", reason: "network" });
    });

    it("should report a format change when the page has no entry markup", async () => {
      const source = createOxfordLearnersSource(
        httpServing({ [`${ENTRY}kitchen`]: { status: 200, body: "<html><body>redesigned</body></html>" } }),
      );
      await expect(source.lookup("kitchen", {})).resolves.toMatchObject({
        status: "unavailable",
        reason: "format-changed",
      });
    });
  });

  describe("entry URL", () => {
    it("should lowercase the word and join a phrase with hyphens", () => {
      expect(createOxfordLearnersSource(httpServing({})).entryUrl("Give Up ")).toBe(`${ENTRY}give-up`);
    });

    it("should percent-encode characters that would change the request path", () => {
      expect(createOxfordLearnersSource(httpServing({})).entryUrl("and/or")).toBe(`${ENTRY}and%2For`);
    });
  });
});
