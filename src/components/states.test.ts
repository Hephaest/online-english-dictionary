import { describe, expect, it } from "vitest";
import type { DictionarySource } from "../sources/types";
import { lookupResultTitle } from "./states";

const source = { shortTitle: "Cambridge" } as DictionarySource;

describe("lookupResultTitle", () => {
  it("should use the printed headword for a found entry", () => {
    const result = {
      status: "found" as const,
      entry: { source: "cambridge" as const, headword: "Kitchen", url: "", sections: [] },
    };
    expect(lookupResultTitle(source, "kitchen", result)).toBe("Kitchen");
  });

  it("should name the word and the source for a miss", () => {
    expect(lookupResultTitle(source, "serendipty", { status: "not-found", suggestions: [] })).toBe(
      "No Entry for “serendipty” in Cambridge",
    );
  });

  it("should give each unavailable reason its own headline", () => {
    const titles = (["network", "blocked", "format-changed", "missing-key", "rejected-key"] as const).map((reason) =>
      lookupResultTitle(source, "run", { status: "unavailable", reason, message: "" }),
    );
    expect(titles).toEqual([
      "Couldn’t Reach Cambridge",
      "Cambridge Refused the Request",
      "Cambridge Page Format Changed",
      "Cambridge Needs an API Key",
      "Cambridge Rejected the Key",
    ]);
  });
});
