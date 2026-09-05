import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NetworkError } from "../http/client";
import type { HttpClient } from "../http/client";
import { createUrbanDictionarySource } from "./urban";

const DEFINE = "https://api.urbandictionary.com/v0/define?term=";
const AUTOCOMPLETE = "https://api.urbandictionary.com/v0/autocomplete?term=";

type Routes = Record<string, { status: number; body: string }>;

function fixture(name: string): string {
  return readFileSync(path.join(__dirname, "../../tests/fixtures/urban", `${name}.json`), "utf8");
}

function httpServing(routes: Routes): Pick<HttpClient, "fetchText"> {
  return {
    async fetchText(url) {
      const route = routes[url];
      if (!route) throw new NetworkError(url, new Error("no route"));
      return { status: route.status, url, contentType: "application/json", body: route.body };
    },
  };
}

async function lookupFound(word: string, routes: Routes) {
  const result = await createUrbanDictionarySource(httpServing(routes)).lookup(word, {});
  if (result.status !== "found") throw new Error(`expected found, got ${result.status}`);
  return result.entry;
}

describe("createUrbanDictionarySource", () => {
  describe("entry parsing", () => {
    const routes = { [`${DEFINE}serendipity`]: { status: 200, body: fixture("serendipity") } };

    it("should read the headword and link to the definition page for it", async () => {
      const entry = await lookupFound("serendipity", routes);
      expect(entry.source).toBe("urban");
      expect(entry.headword).toBe("serendipity");
      expect(entry.url).toBe("https://www.urbandictionary.com/define.php?term=serendipity");
    });

    it("should collect every definition into one untitled-part-of-speech section", async () => {
      const entry = await lookupFound("serendipity", routes);
      expect(entry.sections).toHaveLength(1);
      expect(entry.sections[0].title).toBe("Definitions");
      expect(entry.sections[0].partOfSpeech).toBeUndefined();
      expect(entry.sections[0].badges).toEqual([]);
      expect(entry.sections[0].senses).toHaveLength(10);
    });

    it("should number the senses from one in the order the endpoint returns them", async () => {
      const entry = await lookupFound("serendipity", routes);
      const senses = entry.sections[0].senses;
      expect(senses.map((sense) => sense.number)).toEqual(senses.map((_, index) => String(index + 1)));
      expect(new Set(senses.map((sense) => sense.id)).size).toBe(senses.length);
    });

    it("should read a definition as plain words with the bracket links removed", async () => {
      const entry = await lookupFound("serendipity", routes);
      const first = entry.sections[0].senses[0];
      expect(first.definition).toBe(
        "The feeling of finding exactly what you needed by accident random The moment a long shot finally pays off clutch When two unrelated plans line up by pure chance clutch.",
      );
      expect(first.examples).toEqual([
        "He took a shortcut and beat everyone to the meeting awesome She opened the wrong door and found the better party wild We missed the bus and ran into an old friend instead perfect We missed the bus and ran into an old friend instead",
      ]);
    });

    it("should normalize an example that mixes carriage returns with plain newlines", async () => {
      const entry = await lookupFound("serendipity", routes);
      const example = entry.sections[0].senses[4].examples[0];
      expect(example).toBe(
        "“lucky.” -awesome We missed the bus and ran into an old friend instead\nI put one coin in the machine and three drinks came out awesome\n\nShe opened the wrong door and found the better party",
      );
      expect(example).not.toContain("\r");
    });

    it("should badge each sense with its votes and credit the author with the date written", async () => {
      const entry = await lookupFound("serendipity", routes);
      const first = entry.sections[0].senses[0];
      expect(first.labels).toEqual([{ kind: "votes", text: "0 up · 0 down" }]);
      expect(first.note).toBe("by Devon Ashby, 2004-05-04");
    });

    it("should offer one synthesized US clip taken from the response and nothing else", async () => {
      const entry = await lookupFound("serendipity", routes);
      const played = JSON.parse(fixture("serendipity")).list[0].play_sound_url;
      expect(entry.sections[0].pronunciations).toEqual([{ variant: "us", audioUrl: played, synthesized: true }]);
    });
  });

  describe("stored headword spelling", () => {
    const routes = { [`${DEFINE}yeet`]: { status: 200, body: fixture("yeet") } };

    it("should show the stored headword and link to that spelling, not the typed one", async () => {
      const entry = await lookupFound("yeet", routes);
      expect(entry.headword).toBe("Yeet");
      expect(entry.url).toBe("https://www.urbandictionary.com/define.php?term=Yeet");
    });

    it("should trim the padding an author name carries", async () => {
      const entry = await lookupFound("yeet", routes);
      expect(entry.sections[0].senses[0].note).toBe("by Rae Pilkington, 2018-04-22");
    });
  });

  describe("missing audio clips", () => {
    const routes = { [`${DEFINE}emoji`]: { status: 200, body: fixture("emoji") } };

    it("should read the definitions when every clip URL comes back null", async () => {
      const entry = await lookupFound("emoji", routes);
      expect(entry.headword).toBe("emoji");
      expect(entry.sections[0].senses).toHaveLength(10);
      expect(entry.sections[0].senses[0].definition.length).toBeGreaterThan(0);
    });

    it("should offer no pronunciation at all", async () => {
      const entry = await lookupFound("emoji", routes);
      expect(entry.sections[0].pronunciations).toEqual([]);
    });
  });

  describe("sense without an example", () => {
    it("should return the sense with an empty example list", async () => {
      const body = JSON.stringify({
        list: [
          {
            defid: 1,
            word: "quiet",
            definition: "A word with [no] example.",
            example: "",
            author: "someone",
            written_on: "2020-01-02T00:00:00.000Z",
            thumbs_up: 3,
            thumbs_down: 1,
            permalink: "https://www.urbandictionary.com/define.php?term=quiet&defid=1",
            play_sound_url: null,
          },
        ],
      });
      const entry = await lookupFound("quiet", { [`${DEFINE}quiet`]: { status: 200, body } });
      const [sense] = entry.sections[0].senses;
      expect(sense.examples).toEqual([]);
      expect(sense.labels).toEqual([{ kind: "votes", text: "3 up · 1 down" }]);
    });
  });

  describe("not-found lookups", () => {
    it("should report not found on an empty list rather than trusting the HTTP status", async () => {
      const source = createUrbanDictionarySource(
        httpServing({
          [`${DEFINE}zzzqqqxxnotaword123`]: { status: 200, body: fixture("miss") },
          [`${AUTOCOMPLETE}zzzqqqxxnotaword123`]: { status: 200, body: fixture("autocomplete-miss") },
        }),
      );
      await expect(source.lookup("zzzqqqxxnotaword123", {})).resolves.toEqual({
        status: "not-found",
        suggestions: [],
      });
    });

    it("should offer the terms the autocomplete endpoint knows", async () => {
      const source = createUrbanDictionarySource(
        httpServing({
          [`${DEFINE}seren`]: { status: 200, body: fixture("miss") },
          [`${AUTOCOMPLETE}seren`]: { status: 200, body: fixture("autocomplete-seren") },
        }),
      );
      const result = await source.lookup("seren", {});
      expect(result).toMatchObject({ status: "not-found" });
      if (result.status !== "not-found") return;
      expect(result.suggestions[0]).toBe("Serenity");
      expect(result.suggestions).toContain("serendipity");
    });

    it("should still report not found when the suggestion call fails", async () => {
      const source = createUrbanDictionarySource(
        httpServing({ [`${DEFINE}seren`]: { status: 200, body: fixture("miss") } }),
      );
      await expect(source.lookup("seren", {})).resolves.toEqual({ status: "not-found", suggestions: [] });
    });

    it("should ignore a suggestion response that is not a list of terms", async () => {
      const source = createUrbanDictionarySource(
        httpServing({
          [`${DEFINE}seren`]: { status: 200, body: fixture("miss") },
          [`${AUTOCOMPLETE}seren`]: { status: 200, body: '{"results":[{"term":"Serenity"}]}' },
        }),
      );
      await expect(source.lookup("seren", {})).resolves.toEqual({ status: "not-found", suggestions: [] });
    });
  });

  describe("unavailable responses", () => {
    it("should report a blocked request on HTTP 429", async () => {
      const source = createUrbanDictionarySource(httpServing({ [`${DEFINE}yeet`]: { status: 429, body: "" } }));
      await expect(source.lookup("yeet", {})).resolves.toMatchObject({ status: "unavailable", reason: "blocked" });
    });

    it("should report a network failure when the request never completes", async () => {
      const source = createUrbanDictionarySource(httpServing({}));
      await expect(source.lookup("yeet", {})).resolves.toMatchObject({ status: "unavailable", reason: "network" });
    });

    it("should report a network failure on a server error", async () => {
      const source = createUrbanDictionarySource(httpServing({ [`${DEFINE}yeet`]: { status: 502, body: "" } }));
      await expect(source.lookup("yeet", {})).resolves.toMatchObject({ status: "unavailable", reason: "network" });
    });

    it("should report a format change when the body is not JSON", async () => {
      const source = createUrbanDictionarySource(
        httpServing({ [`${DEFINE}yeet`]: { status: 200, body: "<html>maintenance</html>" } }),
      );
      await expect(source.lookup("yeet", {})).resolves.toMatchObject({
        status: "unavailable",
        reason: "format-changed",
      });
    });

    it("should drop a definition that lost a field it needs and keep the rest", async () => {
      const intact = {
        defid: 2,
        word: "yeet",
        definition: "to throw with force",
        example: "",
        author: "someone",
        written_on: "2020-01-01T00:00:00.000Z",
        thumbs_up: 1,
        thumbs_down: 0,
        play_sound_url: null,
      };
      const body = JSON.stringify({ list: [{ defid: 1, word: "yeet", definition: "to throw" }, intact] });
      const source = createUrbanDictionarySource(httpServing({ [`${DEFINE}yeet`]: { status: 200, body } }));
      const result = await source.lookup("yeet", {});
      expect(result.status).toBe("found");
      if (result.status !== "found") return;
      expect(result.entry.sections[0].senses.map((sense) => sense.definition)).toEqual(["to throw with force"]);
    });
  });

  describe("entry URL", () => {
    it("should build the entry URL with the phrase encoded", () => {
      expect(createUrbanDictionarySource(httpServing({})).entryUrl(" on fleek ")).toBe(
        "https://www.urbandictionary.com/define.php?term=on%20fleek",
      );
    });
  });
});
