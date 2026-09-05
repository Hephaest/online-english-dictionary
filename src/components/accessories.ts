import { Color } from "@raycast/api";
import type { List } from "@raycast/api";
import type { SourceId } from "../model/entry";
import type { DictionarySource } from "../sources/types";

/** One fixed color per dictionary, off Raycast's red and yellow status hues, so a source reads at a glance on every row. */
const SOURCE_COLORS: Record<SourceId, Color> = {
  cambridge: Color.Blue,
  longman: Color.Orange,
  "oxford-learners": Color.Purple,
  "merriam-webster": Color.Magenta,
  urban: Color.Green,
};

export function sourceTag(source: Pick<DictionarySource, "id" | "title">): List.Item.Accessory {
  return { tag: { value: source.title, color: SOURCE_COLORS[source.id] } };
}
