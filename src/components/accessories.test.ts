import { describe, expect, it } from "vitest";
import { allSources } from "../sources";
import { sourceTag } from "./accessories";

describe("sourceTag", () => {
  it("should give every dictionary a color of its own", () => {
    const colors = allSources.map((source) => {
      const accessory = sourceTag(source);
      const tag = "tag" in accessory ? accessory.tag : undefined;
      return typeof tag === "object" && tag !== null && "color" in tag ? tag.color : undefined;
    });
    expect(colors).not.toContain(undefined);
    expect(new Set(colors).size).toBe(allSources.length);
  });
});
