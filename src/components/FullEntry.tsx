import { Action, Detail, Icon } from "@raycast/api";
import { useCachedState } from "@raycast/utils";
import { useMemo, useState } from "react";
import { useActiveSource } from "../hooks/useActiveSource";
import { useLookup } from "../hooks/useLookup";
import type { SourceId } from "../model/entry";
import { entryMarkdown } from "../model/markdown";
import { readPreferences } from "../preferences";
import { availableSources, findSource, resolveSource } from "../sources";
import { EntryActions, RecoveryActions } from "./EntryActions";
import { EntryMetadata } from "./EntryMetadata";
import { lookupResultTitle } from "./states";

interface FullEntryProps {
  word: string;
  sourceId: SourceId;
  substitutionNote?: string;
  /** Keeps the entry screen underneath on the same source when it is switched here. */
  onSwitchSource?: (id: SourceId) => void;
}

/** The whole entry at reading width. */
export function FullEntry({ word, sourceId, substitutionNote, onSwitchSource }: FullEntryProps) {
  const preferences = useMemo(readPreferences, []);
  const sources = useMemo(() => availableSources(preferences), [preferences]);
  const [, setActiveSourceId] = useActiveSource(preferences.defaultSource);
  const [currentSourceId, setCurrentSourceId] = useState(sourceId);
  const source = resolveSource(sources, currentSourceId, preferences.defaultSource);
  const { result, resultSourceId, isLoading, refresh } = useLookup(source, word, preferences.merriamWebster);
  const [hideMetadata, setHideMetadata] = useCachedState("full-entry-hide-metadata", false);

  function switchSource(id: SourceId) {
    setCurrentSourceId(id);
    setActiveSourceId(id);
    onSwitchSource?.(id);
  }

  if (result?.status === "found") {
    const entry = result.entry;
    const section = entry.sections[0];
    // While a switch loads, the pane still shows the previous entry, labelled with its own source.
    const shownSource = findSource(sources, resultSourceId) ?? source;
    return (
      <Detail
        navigationTitle={word}
        isLoading={isLoading}
        markdown={entryMarkdown(entry, { substitutionNote })}
        metadata={
          hideMetadata || !section ? undefined : <EntryMetadata source={shownSource} entry={entry} section={section} />
        }
        actions={
          section && (
            <EntryActions
              source={shownSource}
              sources={sources}
              entry={entry}
              section={section}
              preferences={preferences}
              onSwitchSource={switchSource}
              onRefresh={refresh}
              viewActions={
                <Action
                  title={hideMetadata ? "Show Metadata" : "Hide Metadata"}
                  icon={hideMetadata ? Icon.Eye : Icon.EyeDisabled}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "h" }}
                  onAction={() => setHideMetadata(!hideMetadata)}
                />
              }
            />
          )
        }
      />
    );
  }

  const title = result ? lookupResultTitle(source, word, result) : word;
  const message =
    result?.status === "unavailable" ? result.message : result ? "Try another dictionary with ⌘] or ⌘⇧D." : "";
  return (
    <Detail
      navigationTitle={word}
      isLoading={isLoading}
      markdown={`# ${title}\n\n${message}`}
      actions={
        <RecoveryActions
          source={source}
          sources={sources}
          word={word}
          onSwitchSource={switchSource}
          onRefresh={refresh}
          showPreferences={
            result?.status === "unavailable" && (result.reason === "missing-key" || result.reason === "rejected-key")
          }
          browserFirst={
            result?.status === "not-found" || (result?.status === "unavailable" && result.reason === "format-changed")
          }
        />
      }
    />
  );
}
