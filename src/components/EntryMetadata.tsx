import { Color, Detail } from "@raycast/api";
import type { Badge, Entry, EntrySection, Sense } from "../model/entry";
import { oedSearchUrl } from "../sources";
import type { DictionarySource } from "../sources/types";

interface EntryMetadataProps {
  source: DictionarySource;
  entry: Entry;
  section: EntrySection;
  sense?: Sense;
}

const LEVEL_KINDS: Badge["kind"][] = ["cefr", "frequency", "label"];

/** Side panel for the entry pane and the full entry page; Raycast uses one Metadata component for both hosts. */
export function EntryMetadata({ source, entry, section, sense }: EntryMetadataProps) {
  const levels = section.badges.filter((badge) => LEVEL_KINDS.includes(badge.kind));
  const labels = sense?.labels ?? [];
  return (
    <Detail.Metadata>
      {section.pronunciations.length > 0 && (
        <Detail.Metadata.TagList title="Pronunciation">
          {section.pronunciations.map((pronunciation) => (
            <Detail.Metadata.TagList.Item
              key={pronunciation.variant}
              text={pronunciation.synthesized ? "Text to speech" : pronunciation.variant.toUpperCase()}
              color={pronunciation.audioUrl ? Color.Green : Color.SecondaryText}
            />
          ))}
        </Detail.Metadata.TagList>
      )}
      {levels.length > 0 && (
        <Detail.Metadata.TagList title="Level">
          {levels.map((badge) => (
            <Detail.Metadata.TagList.Item key={`${badge.kind}-${badge.text}`} text={badge.text} color={Color.Blue} />
          ))}
        </Detail.Metadata.TagList>
      )}
      {labels.length > 0 && (
        <Detail.Metadata.TagList title="Labels">
          {labels.map((badge) => (
            <Detail.Metadata.TagList.Item key={`${badge.kind}-${badge.text}`} text={badge.text} />
          ))}
        </Detail.Metadata.TagList>
      )}
      <Detail.Metadata.Separator />
      <Detail.Metadata.Label title="Source" text={source.title} />
      <Detail.Metadata.Link title="Entry" target={entry.url} text={`Open in ${source.shortTitle}`} />
      <Detail.Metadata.Link
        title="Oxford English Dictionary"
        target={oedSearchUrl(entry.headword)}
        text="Open in OED"
      />
    </Detail.Metadata>
  );
}
