import { describe, expect, it } from "vitest";
import { allSources, availableSources, neighborSource, oedSearchUrl, resolveSource } from "./index";

describe("availableSources", () => {
  it("should hide Merriam-Webster until a key is configured", () => {
    const ids = availableSources({ merriamWebster: undefined }).map((source) => source.id);
    expect(ids).toEqual(["cambridge", "longman", "oxford-learners", "urban"]);
  });

  it("should list every source in dropdown order once a key is configured", () => {
    const ids = availableSources({ merriamWebster: { apiKey: "k", reference: "collegiate" } }).map(
      (source) => source.id,
    );
    expect(ids).toEqual(["cambridge", "longman", "oxford-learners", "merriam-webster", "urban"]);
  });
});

describe("resolveSource", () => {
  it("should take the first candidate that is available and fall back to the first source", () => {
    const sources = availableSources({ merriamWebster: undefined });
    expect(resolveSource(sources, "merriam-webster", "urban").id).toBe("urban");
    expect(resolveSource(sources, "merriam-webster", undefined).id).toBe("cambridge");
  });
});

describe("neighborSource", () => {
  it("should step forward and backward and wrap around at both ends", () => {
    expect(neighborSource(allSources, "urban", 1).id).toBe("cambridge");
    expect(neighborSource(allSources, "cambridge", -1).id).toBe("urban");
    expect(neighborSource(allSources, "longman", 1).id).toBe("oxford-learners");
  });
});

describe("oedSearchUrl", () => {
  it("should encode the word into the OED search link", () => {
    expect(oedSearchUrl("give up")).toBe("https://www.oed.com/search/dictionary/?scope=Entries&q=give%20up");
  });
});
