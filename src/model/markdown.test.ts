import { describe, expect, it } from "vitest";
import type { Entry, EntrySection } from "./entry";
import {
  entryClipboardText,
  entryMarkdown,
  pronunciationClipboardText,
  pronunciationLine,
  senseClipboardText,
  senseMarkdown,
} from "./markdown";

const section: EntrySection = {
  id: "kitchen-1",
  title: "noun",
  partOfSpeech: "noun",
  pronunciations: [
    { variant: "us", text: "ˈkɪtʃɪn", notation: "ipa", audioUrl: "https://example.test/us.mp3" },
    { variant: "uk", text: "ˈkɪtʃɪn", notation: "ipa" },
  ],
  badges: [
    { kind: "cefr", text: "A1" },
    { kind: "label", text: "Oxford 3000" },
  ],
  senses: [
    {
      id: "s1",
      number: "1",
      definition: "a room in which meals are cooked or prepared",
      examples: ["We ate at the kitchen table.", "a fully fitted kitchen"],
      labels: [{ kind: "grammar", text: "[countable]" }],
      cefr: "A1",
      picture: { thumbUrl: "https://example.test/thumb.png", fullUrl: "https://example.test/full.png" },
    },
    { id: "s2", number: "2", definition: "the staff who work in a kitchen", examples: [], labels: [] },
  ],
};

const respelled: EntrySection = {
  ...section,
  pronunciations: [{ variant: "us", text: "ˈki-chən", notation: "respelling", audioUrl: "https://example.test/a.mp3" }],
};

const entry: Entry = {
  source: "oxford-learners",
  headword: "kitchen",
  url: "https://example.test/kitchen",
  sections: [section],
};

describe("pronunciationLine", () => {
  it("should put US before UK and mark a variant that has no recording", () => {
    expect(pronunciationLine(section)).toBe("us /ˈkɪtʃɪn/ · uk /ˈkɪtʃɪn/ *(no audio)*");
  });

  it("should show a publisher respelling between backslashes instead of IPA slashes", () => {
    expect(pronunciationLine(respelled)).toBe("us \\ˈki-chən\\");
  });
});

describe("senseMarkdown", () => {
  it("should render the headword, badges, numbered definition, picture, and examples as quotes", () => {
    const markdown = senseMarkdown(entry, section, section.senses[0]);
    expect(markdown).toContain("# kitchen");
    expect(markdown).toContain("noun · A1 · Oxford 3000");
    expect(markdown).toContain("**A1** **1.** a room in which meals are cooked or prepared `[countable]`");
    expect(markdown).toContain("![noun](https://example.test/full.png?raycast-width=340)");
    expect(markdown).toContain("> We ate at the kitchen table.");
  });

  it("should print the guideword in bold before the definition and the photo credit under the picture", () => {
    const guided: EntrySection = {
      ...section,
      senses: [
        {
          ...section.senses[0],
          heading: "GO QUICKLY",
          picture: { thumbUrl: "https://example.test/thumb.png", credit: "OJO Images" },
        },
      ],
    };
    const markdown = senseMarkdown(entry, guided, guided.senses[0]);
    expect(markdown).toContain("**1.** **GO QUICKLY** a room in which meals are cooked or prepared");
    expect(markdown).toContain("*Photo: OJO Images*");
  });

  it("should print the substitution note under the headword when a shorter word was looked up", () => {
    const markdown = senseMarkdown(entry, section, section.senses[1], {
      substitutionNote: "Looked up “kitchen” from your selection.",
    });
    expect(markdown.split("\n")[2]).toBe("*Looked up “kitchen” from your selection.*");
    expect(markdown).not.toContain("raycast-width");
  });
});

describe("entryMarkdown", () => {
  it("should render one heading per section with every sense and the picture above them", () => {
    const withSectionPicture: Entry = {
      ...entry,
      sections: [
        { ...section, picture: { thumbUrl: "https://example.test/section.png", caption: "a fitted kitchen" } },
      ],
    };
    const markdown = entryMarkdown(withSectionPicture);
    const lines = markdown.split("\n");
    expect(lines[0]).toBe("# kitchen");
    expect(markdown).toContain("## noun");
    expect(lines.indexOf("![a fitted kitchen](https://example.test/section.png?raycast-width=340)")).toBeLessThan(
      lines.findIndex((line) => line.includes("**1.**")),
    );
    expect(markdown).toContain("**2.** the staff who work in a kitchen");
  });
});

describe("senseClipboardText", () => {
  it("should give the headword, the definition, and indented examples as plain text", () => {
    expect(senseClipboardText(entry, section, section.senses[0])).toBe(
      "kitchen · noun\na room in which meals are cooked or prepared\n  - We ate at the kitchen table.\n  - a fully fitted kitchen",
    );
  });
});

describe("entryClipboardText", () => {
  it("should list every numbered definition under its section title", () => {
    expect(entryClipboardText(entry)).toBe(
      "kitchen\n\nnoun\n1. a room in which meals are cooked or prepared\n2. the staff who work in a kitchen",
    );
  });
});

describe("pronunciationClipboardText", () => {
  it("should list each transcription with its variant and keep the respelling notation", () => {
    expect(pronunciationClipboardText(respelled)).toBe("US \\ˈki-chən\\");
  });
});
