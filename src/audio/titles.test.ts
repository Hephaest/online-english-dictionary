import { describe, expect, it } from "vitest";
import type { EntrySection } from "../model/entry";
import type { DictionarySource } from "../sources/types";
import { pronunciationActionTitle } from "./titles";

const source = { shortTitle: "Merriam-Webster" } as DictionarySource;

function sectionWith(pronunciations: EntrySection["pronunciations"]): EntrySection {
  return { id: "s", title: "noun", pronunciations, badges: [], senses: [] };
}

describe("pronunciationActionTitle", () => {
  it("should name the accent when the source has a recording for it", () => {
    const section = sectionWith([{ variant: "us", audioUrl: "https://example.test/us.mp3" }]);
    expect(pronunciationActionTitle(source, section, "us")).toBe("Play US Pronunciation");
  });

  it("should say the source lacks the accent when there is no recording for it", () => {
    const section = sectionWith([{ variant: "us", audioUrl: "https://example.test/us.mp3" }]);
    expect(pronunciationActionTitle(source, section, "uk")).toBe("Play UK Pronunciation (Not in Merriam-Webster)");
  });

  it("should call a machine-generated clip text to speech instead of a recording", () => {
    const section = sectionWith([{ variant: "us", audioUrl: "https://example.test/tts.mp3", synthesized: true }]);
    expect(pronunciationActionTitle(source, section, "us")).toBe("Play Pronunciation (Text to Speech)");
  });
});
