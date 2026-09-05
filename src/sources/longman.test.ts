import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NetworkError } from "../http/client";
import type { HttpClient } from "../http/client";
import { createLongmanSource } from "./longman";

const ENTRY = "https://www.ldoceonline.com/dictionary/";
const SPELLCHECK = "https://www.ldoceonline.com/spellcheck/english/?q=";

interface Route {
  status: number;
  body: string;
  /** Final URL after redirects; a miss lands on the spellcheck page. */
  url?: string;
}

function fixture(name: string): string {
  return readFileSync(path.join(__dirname, "../../tests/fixtures/longman", `${name}.html`), "utf8");
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
  const result = await createLongmanSource(httpServing(routes)).lookup(word, {});
  if (result.status !== "found") throw new Error(`expected found, got ${result.status}`);
  return result.entry;
}

describe("createLongmanSource", () => {
  describe("entry parsing", () => {
    const routes = { [`${ENTRY}guitar`]: { status: 200, body: fixture("guitar") } };

    it("should read the headword, part of speech, and frequency badges", async () => {
      const entry = await lookupFound("guitar", routes);
      expect(entry.headword).toBe("guitar");
      expect(entry.url).toBe(`${ENTRY}guitar`);
      expect(entry.sections).toHaveLength(1);
      expect(entry.sections[0].partOfSpeech).toBe("noun");
      expect(entry.sections[0].title).toBe("noun");
      expect(entry.sections[0].badges).toEqual([
        { kind: "frequency", text: "S3" },
        { kind: "frequency", text: "W3" },
        { kind: "grammar", text: "countable" },
      ]);
    });

    it("should merge the American variant onto the British transcription and put US first", async () => {
      const entry = await lookupFound("guitar", routes);
      expect(entry.sections[0].pronunciations).toEqual([
        {
          variant: "us",
          text: "ɡɪˈtɑːr",
          notation: "ipa",
          audioUrl: "https://www.ldoceonline.com/media/english/ameProns/guitar.mp3?version=1.2.91",
        },
        {
          variant: "uk",
          text: "ɡɪˈtɑː",
          notation: "ipa",
          audioUrl: "https://www.ldoceonline.com/media/english/breProns/guitar0205.mp3?version=1.2.91",
        },
      ]);
    });

    it("should take the illustration from the entry and never from the site-wide picture widget", async () => {
      const entry = await lookupFound("guitar", routes);
      expect(entry.sections[0].senses[0].picture).toEqual({
        thumbUrl: "https://www.ldoceonline.com/media/english/illustration/guitar.jpg?version=1.2.91",
      });
      expect(entry.sections[0].picture).toBeUndefined();
    });

    it("should keep the parenthesized gloss inside the definition", async () => {
      const entry = await lookupFound("guitar", routes);
      expect(entry.sections[0].senses[0].definition).toBe(
        "a musical instrument usually with six strings that you play by pulling the strings with your fingers or with a plectrum (=small piece of plastic, metal etc)",
      );
    });
  });

  describe("entries without a picture", () => {
    it("should read the senses and their examples without the audio icons", async () => {
      const entry = await lookupFound("kitchen", { [`${ENTRY}kitchen`]: { status: 200, body: fixture("kitchen") } });
      const [first] = entry.sections[0].senses;
      expect(first.definition).toBe("the room where you prepare and cook food");
      expect(first.examples).toEqual([
        "Sam went into the kitchen to make a pot of tea.",
        "She is in the kitchen making a meal.",
      ]);
      expect(first.picture).toBeUndefined();
      expect(entry.sections[0].picture).toBeUndefined();
    });

    it("should reuse the British transcription for US when the page prints no American variant", async () => {
      const entry = await lookupFound("kitchen", { [`${ENTRY}kitchen`]: { status: 200, body: fixture("kitchen") } });
      const [us, uk] = entry.sections[0].pronunciations;
      expect(us.text).toBe("ˈkɪtʃɪn");
      expect(uk.text).toBe("ˈkɪtʃɪn");
      expect(us.audioUrl).toBe("https://www.ldoceonline.com/media/english/ameProns/kitchen.mp3?version=1.2.91");
      expect(uk.audioUrl).toBe("https://www.ldoceonline.com/media/english/breProns/brelasdekitchen.mp3?version=1.2.91");
    });

    it("should keep a sense that only cross-references another entry, showing the phrase it points to", async () => {
      const entry = await lookupFound("kitchen", { [`${ENTRY}kitchen`]: { status: 200, body: fixture("kitchen") } });
      expect(entry.sections[0].senses.map((sense) => sense.number)).toEqual(["1", "2"]);
      expect(entry.sections[0].senses[1].definition).toBe("→ everything but the kitchen sink");
      expect(entry.sections[0].senses[1].examples).toEqual([]);
    });

    it("should carry a register label from the headword block", async () => {
      const entry = await lookupFound("serendipity", {
        [`${ENTRY}serendipity`]: { status: 200, body: fixture("serendipity") },
      });
      expect(entry.sections[0].badges).toContainEqual({ kind: "register", text: "literary" });
      expect(entry.sections[0].senses[0].definition).toBe(
        "when interesting or valuable discoveries are made by accident",
      );
    });
  });

  describe("homograph pages", () => {
    const routes = { [`${ENTRY}run`]: { status: 200, body: fixture("run") } };

    it("should keep one section per homograph and name the dictionary in the title", async () => {
      const entry = await lookupFound("run", routes);
      expect(entry.sections.map((section) => section.title)).toEqual([
        "verb (1) · Contemporary English",
        "noun (2) · Contemporary English",
        "verb (1) · Business",
        "noun (2) · Business",
      ]);
      expect(entry.sections.map((section) => section.partOfSpeech)).toEqual(["verb", "noun", "verb", "noun"]);
    });

    it("should flatten sub-senses into numbered senses that inherit the signpost", async () => {
      const entry = await lookupFound("run", routes);
      const [first, second] = entry.sections[0].senses;
      expect(first.number).toBe("1a");
      expect(second.number).toBe("1b");
      expect(first.definition).toBe("to move very quickly, by moving your legs more quickly than when you walk");
      expect(first.labels).toContainEqual({ kind: "label", text: "move quickly using your legs" });
      expect(first.labels).toContainEqual({ kind: "grammar", text: "intransitive" });
    });

    it("should keep register labels on the sense that carries them", async () => {
      const entry = await lookupFound("run", routes);
      const sense = entry.sections
        .flatMap((section) => section.senses)
        .find((candidate) => candidate.definition.startsWith("to take someone somewhere in your car"));
      expect(sense?.labels).toContainEqual({ kind: "register", text: "informal" });
    });

    it("should give every sense of the entry a unique id", async () => {
      const entry = await lookupFound("run", routes);
      const ids = entry.sections.flatMap((section) => section.senses).map((sense) => sense.id);
      expect(ids.length).toBeGreaterThan(50);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("should number the senses without gaps by keeping the phrase cross-references", async () => {
      const entry = await lookupFound("run", routes);
      const numbers = entry.sections[1].senses.map((sense) => sense.number);
      expect(numbers).toEqual([
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
        "10",
        "11",
        "12",
        "13",
        "14",
        "15",
        "16a",
        "16b",
        "17",
        "18",
        "19",
        "20",
        "21",
        "22",
        "23",
      ]);
      expect(entry.sections[1].senses[1].definition).toBe("→ in the long run");
    });

    it("should attach no picture to a page that only carries the decoy illustrations", async () => {
      const entry = await lookupFound("run", routes);
      const pictures = entry.sections.flatMap((section) => [section.picture, ...section.senses.map((s) => s.picture)]);
      expect(pictures.every((picture) => picture === undefined)).toBe(true);
    });

    it("should read audio for a homograph whose headword block prints no transcription", async () => {
      const entry = await lookupFound("run", routes);
      const noun = entry.sections[1];
      expect(noun.pronunciations.map((pronunciation) => pronunciation.variant)).toEqual(["us", "uk"]);
      expect(noun.pronunciations[0].audioUrl).toContain("/ameProns/run1.mp3");
      expect(noun.pronunciations[0].text).toBeUndefined();
    });
  });

  describe("not-found responses", () => {
    it("should report not found when the page redirects to spellcheck with no suggestions", async () => {
      const source = createLongmanSource(
        httpServing({
          [`${ENTRY}zzzqqqnotaword`]: {
            status: 200,
            body: fixture("miss"),
            url: `${SPELLCHECK}zzzqqqnotaword&entrySet=C`,
          },
        }),
      );
      await expect(source.lookup("zzzqqqnotaword", {})).resolves.toEqual({ status: "not-found", suggestions: [] });
    });

    it("should return the did-you-mean words when the spellcheck page lists them", async () => {
      const source = createLongmanSource(
        httpServing({
          [`${ENTRY}serendipty`]: {
            status: 200,
            body: fixture("suggestions"),
            url: `${SPELLCHECK}serendipty&entrySet=A`,
          },
        }),
      );
      await expect(source.lookup("serendipty", {})).resolves.toEqual({
        status: "not-found",
        suggestions: [
          "serendipity",
          "serenity",
          "serendipities",
          "serenading",
          "serenely",
          "serenest",
          "servility",
          "rending",
          "sending",
          "serenade",
        ],
      });
    });
  });

  describe("unavailable responses", () => {
    it("should report a blocked request on HTTP 403", async () => {
      const source = createLongmanSource(httpServing({ [`${ENTRY}guitar`]: { status: 403, body: "" } }));
      await expect(source.lookup("guitar", {})).resolves.toMatchObject({ status: "unavailable", reason: "blocked" });
    });

    it("should report a network failure when the request never completes", async () => {
      const source = createLongmanSource(httpServing({}));
      await expect(source.lookup("guitar", {})).resolves.toMatchObject({ status: "unavailable", reason: "network" });
    });

    it("should report a format change when a page with no entries is not the spellcheck page", async () => {
      const source = createLongmanSource(
        httpServing({ [`${ENTRY}guitar`]: { status: 200, body: "<html><body>redesigned</body></html>" } }),
      );
      await expect(source.lookup("guitar", {})).resolves.toMatchObject({
        status: "unavailable",
        reason: "format-changed",
      });
    });
  });

  describe("entry URL", () => {
    it("should build the entry URL with hyphens for a phrase", () => {
      expect(createLongmanSource(httpServing({})).entryUrl("Give Up ")).toBe(`${ENTRY}give-up`);
    });

    it("should percent-encode characters that would change the request path", () => {
      expect(createLongmanSource(httpServing({})).entryUrl("and/or")).toBe(`${ENTRY}and%2For`);
    });
  });
});
