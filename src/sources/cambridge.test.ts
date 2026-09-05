import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NetworkError } from "../http/client";
import type { HttpClient } from "../http/client";
import { createCambridgeSource } from "./cambridge";

const ENTRY = "https://dictionary.cambridge.org/dictionary/english/";

interface Route {
  status: number;
  body: string;
  /** Final URL after redirects, when the site does not stay on the requested one. */
  url?: string;
}

function fixture(name: string): string {
  return readFileSync(path.join(__dirname, "../../tests/fixtures/cambridge", `${name}.html`), "utf8");
}

function httpServing(routes: Record<string, Route>): Pick<HttpClient, "fetchText"> {
  return {
    async fetchText(url) {
      const route = routes[url];
      if (!route) throw new NetworkError(url, new Error("no route"));
      return { status: route.status, url: route.url ?? url, contentType: "text/html", body: route.body };
    },
  };
}

async function lookupFound(word: string, routes: Record<string, Route>) {
  const result = await createCambridgeSource(httpServing(routes)).lookup(word, {});
  if (result.status !== "found") throw new Error(`expected found, got ${result.status}`);
  return result.entry;
}

describe("createCambridgeSource", () => {
  describe("entry parsing", () => {
    const routes = { [`${ENTRY}kitchen`]: { status: 200, body: fixture("kitchen") } };

    it("should read the headword and one section per dictionary on the page", async () => {
      const entry = await lookupFound("kitchen", routes);
      expect(entry.headword).toBe("kitchen");
      expect(entry.url).toBe(`${ENTRY}kitchen`);
      expect(entry.sections.map((section) => section.title)).toEqual(["English · noun", "American Dictionary · noun"]);
      expect(entry.sections[0].partOfSpeech).toBe("noun");
      expect(entry.sections[0].badges).toEqual([{ kind: "grammar", text: "[ C ]" }]);
    });

    it("should read US and UK pronunciation text and audio from the block, US first", async () => {
      const entry = await lookupFound("kitchen", routes);
      const [us, uk] = entry.sections[0].pronunciations;
      expect(us).toEqual({
        variant: "us",
        text: "ˈkɪtʃ.ən",
        notation: "ipa",
        audioUrl: "https://dictionary.cambridge.org/media/english/us_pron/k/kit/kitch/kitchen.mp3",
      });
      expect(uk.variant).toBe("uk");
      expect(uk.audioUrl).toBe("https://dictionary.cambridge.org/media/english/uk_pron/u/ukk/ukkit/ukkit__002.mp3");
    });

    it("should attach the picture to the sense that carries it, with the full-size URL and the credit", async () => {
      const entry = await lookupFound("kitchen", routes);
      expect(entry.sections[0].senses[0].picture).toEqual({
        thumbUrl: "https://dictionary.cambridge.org/images/thumb/kitche_noun_002_20302.jpg?version=6.0.80",
        fullUrl: "https://dictionary.cambridge.org/images/full/kitche_noun_002_20302.jpg?version=6.0.80",
        credit: "Daly and Newton/OJO Images/GettyImages",
      });
    });

    it("should keep the definition without its trailing colon, the level, and the examples", async () => {
      const entry = await lookupFound("kitchen", routes);
      const [first] = entry.sections[0].senses;
      expect(first.id).toBe("ID_00017897_01");
      expect(first.definition).toBe("a room where food is kept, prepared, and cooked and where the dishes are washed");
      expect(first.cefr).toBe("A1");
      expect(first.examples[0]).toBe("We usually eat breakfast in the kitchen.");
    });
  });

  describe("entry without a picture", () => {
    const routes = { [`${ENTRY}serendipity`]: { status: 200, body: fixture("serendipity") } };

    it("should return one section with one sense and no picture", async () => {
      const entry = await lookupFound("serendipity", routes);
      expect(entry.sections).toHaveLength(1);
      expect(entry.sections[0].senses).toHaveLength(1);
      expect(entry.sections[0].senses[0].definition).toBe(
        "the fact of finding interesting or valuable things by chance",
      );
      expect(entry.sections[0].senses[0].picture).toBeUndefined();
    });

    it("should leave the uncurated corpus sentences out of the examples", async () => {
      const entry = await lookupFound("serendipity", routes);
      expect(entry.sections[0].senses[0].examples).toEqual([]);
    });

    it("should ignore the audio of the other words the page links to", async () => {
      const entry = await lookupFound("serendipity", routes);
      expect(entry.sections[0].pronunciations.map((pronunciation) => pronunciation.audioUrl)).toEqual([
        "https://dictionary.cambridge.org/media/english/us_pron/u/uss/usser/usserap008.mp3",
        "https://dictionary.cambridge.org/media/english/uk_pron/u/uks/ukser/ukseren003.mp3",
      ]);
      expect(entry.sections[0].pronunciations[0].text).toBe("ˌser.ənˈdɪp.ə.t̬i");
    });
  });

  describe("multiple dictionary blocks", () => {
    const routes = { [`${ENTRY}run`]: { status: 200, body: fixture("run") } };

    it("should make one section per dictionary block per part of speech", async () => {
      const entry = await lookupFound("run", routes);
      expect(entry.sections.map((section) => section.title)).toEqual([
        "English · verb",
        "English · noun",
        "American Dictionary · verb",
        "American Dictionary · noun",
        "Business English · verb",
        "Business English · noun",
      ]);
    });

    it("should give the American dictionary block no British pronunciation", async () => {
      const entry = await lookupFound("run", routes);
      const american = entry.sections.filter((section) => section.title.startsWith("American Dictionary"));
      expect(american.flatMap((section) => section.pronunciations).map((sound) => sound.variant)).toEqual(["us", "us"]);
    });

    it("should use the page's own sense ids and number senses continuously within a section", async () => {
      const entry = await lookupFound("run", routes);
      const senses = entry.sections[0].senses;
      expect(senses[0].id).toBe("ID_00027772_01");
      expect(senses.map((sense) => sense.number)).toEqual(senses.map((_, index) => String(index + 1)));
      const ids = entry.sections.flatMap((section) => section.senses).map((sense) => sense.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("should keep the guideword as the sense heading and the grammar and region labels on the sense", async () => {
      const entry = await lookupFound("run", routes);
      const senses = entry.sections.flatMap((section) => section.senses);
      expect(senses[0].heading).toBe("GO QUICKLY");
      expect(senses[0].labels).toEqual([{ kind: "grammar", text: "[ I or T ]" }]);
      const election = senses.find((sense) => sense.definition.startsWith("to compete as a candidate in an election"));
      expect(election?.labels).toContainEqual({ kind: "region", text: "mainly US" });
      const scale = senses.find((sense) => sense.definition.startsWith("a series of notes of a scale"));
      expect(scale?.labels).toContainEqual({ kind: "register", text: "specialized" });
    });

    it("should attach the picture to the noun sense that carries it", async () => {
      const entry = await lookupFound("run", routes);
      const withPicture = entry.sections.flatMap((section) => section.senses).filter((sense) => sense.picture);
      expect(withPicture).toHaveLength(1);
      expect(withPicture[0].picture?.thumbUrl).toBe(
        "https://dictionary.cambridge.org/images/thumb/run_noun_004_2247.jpg?version=6.0.80",
      );
      expect(withPicture[0].definition).toContain("a long, vertical hole in tights");
    });
  });

  describe("phrasal verb pages", () => {
    const routes = { [`${ENTRY}give-up`]: { status: 200, body: fixture("give-up") } };

    it("should report the phrasal verb itself as the headword", async () => {
      const entry = await lookupFound("give up", routes);
      expect(entry.headword).toBe("give up");
      expect(entry.sections[0].partOfSpeech).toBe("phrasal verb");
      expect(entry.sections[0].senses[0].id).toBe("ID_00013616_43");
      expect(entry.sections[0].senses[0].definition).toBe("to stop trying to guess");
    });

    it("should keep each phrasal verb pattern as its own section", async () => {
      const entry = await lookupFound("give up", routes);
      expect(entry.sections.map((section) => section.title)).toContain("English · phrasal verb · give something up");
      expect(entry.sections.map((section) => section.title)).toContain("Business English · phrasal verb");
    });

    it("should build the entry URL with hyphens and lower case for a phrase", () => {
      const source = createCambridgeSource(httpServing({}));
      expect(source.entryUrl("Give Up ")).toBe(`${ENTRY}give-up`);
      expect(source.entryUrl("Serendipity")).toBe(`${ENTRY}serendipity`);
    });
  });

  describe("not-found responses", () => {
    it("should report not found when the site answers HTTP 200 at its index page", async () => {
      const source = createCambridgeSource(
        httpServing({
          [`${ENTRY}zzzqqqnotaword`]: { status: 200, body: fixture("miss"), url: ENTRY },
        }),
      );
      await expect(source.lookup("zzzqqqnotaword", {})).resolves.toEqual({ status: "not-found", suggestions: [] });
    });

    it("should report not found with the headword the site corrected to when it redirects to a different entry", async () => {
      const source = createCambridgeSource(
        httpServing({
          [`${ENTRY}givup`]: { status: 200, body: fixture("give-up"), url: `${ENTRY}give-up?q=givup` },
        }),
      );
      const result = await source.lookup("givup", {});
      expect(result.status).toBe("not-found");
      if (result.status !== "not-found") return;
      expect(result.suggestions[0]).toBe("give up");
      expect(new Set(result.suggestions).size).toBe(result.suggestions.length);
    });

    it("should report not found when the entry page stays on its own URL but prints no headword span", async () => {
      const source = createCambridgeSource(
        httpServing({
          [`${ENTRY}zzzqqqnotaword`]: {
            status: 200,
            body: '<html><body><div class="page"><p>No results found for that word.</p></div></body></html>',
          },
        }),
      );
      await expect(source.lookup("zzzqqqnotaword", {})).resolves.toEqual({ status: "not-found", suggestions: [] });
    });
  });

  describe("unavailable responses", () => {
    it("should report a blocked request on HTTP 403", async () => {
      const source = createCambridgeSource(httpServing({ [`${ENTRY}kitchen`]: { status: 403, body: "" } }));
      await expect(source.lookup("kitchen", {})).resolves.toMatchObject({ status: "unavailable", reason: "blocked" });
    });

    it("should report a blocked request on the HTTP 520 the origin returns to a refused User-Agent", async () => {
      const source = createCambridgeSource(httpServing({ [`${ENTRY}kitchen`]: { status: 520, body: "" } }));
      await expect(source.lookup("kitchen", {})).resolves.toMatchObject({ status: "unavailable", reason: "blocked" });
    });

    it("should report a network failure when the request never completes", async () => {
      const source = createCambridgeSource(httpServing({}));
      await expect(source.lookup("kitchen", {})).resolves.toMatchObject({ status: "unavailable", reason: "network" });
    });

    it("should report a network failure on a server error the site does not use to refuse traffic", async () => {
      const source = createCambridgeSource(httpServing({ [`${ENTRY}kitchen`]: { status: 500, body: "" } }));
      await expect(source.lookup("kitchen", {})).resolves.toMatchObject({ status: "unavailable", reason: "network" });
    });

    it("should report a format change when the headword is there but the entry blocks are gone", async () => {
      const source = createCambridgeSource(
        httpServing({
          [`${ENTRY}kitchen`]: { status: 200, body: '<html><body><span class="hw dhw">kitchen</span></body></html>' },
        }),
      );
      await expect(source.lookup("kitchen", {})).resolves.toMatchObject({
        status: "unavailable",
        reason: "format-changed",
      });
    });

    it("should report a format change when the entry block is there but carries no sense", async () => {
      const source = createCambridgeSource(
        httpServing({
          [`${ENTRY}kitchen`]: {
            status: 200,
            body:
              '<html><body><h1>kitchen in English</h1><div class="pr dictionary" data-id="cald4">' +
              '<div class="pr entry-body__el"><div class="di-title">' +
              '<span class="hw dhw headword">kitchen</span></div></div></div></body></html>',
          },
        }),
      );
      await expect(source.lookup("kitchen", {})).resolves.toMatchObject({
        status: "unavailable",
        reason: "format-changed",
      });
    });
  });
});
