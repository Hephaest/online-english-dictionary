import { Action, ActionPanel, Icon, Keyboard, LaunchProps, List, useNavigation } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useEffect, useMemo, useRef, useState } from "react";
import { EntryScreen } from "./components/EntryScreen";
import { SourceDropdown } from "./components/SourceDropdown";
import { useActiveSource } from "./hooks/useActiveSource";
import type { SourceId } from "./model/entry";
import { readPreferences } from "./preferences";
import { forgetLookup, listRecent } from "./recent";
import type { RecentLookup } from "./recent";
import { availableSources, findSource, resolveSource } from "./sources";
import type { DictionarySource } from "./sources/types";

/** Payload sent by Define Selected Word. */
export interface SearchLaunchContext {
  word?: string;
  substitutedFrom?: string;
}

interface LookupRowProps {
  word: string;
  source: DictionarySource;
  onLookedUp: () => void;
}

function LookupRow({ word, source, onLookedUp }: LookupRowProps) {
  return (
    <List.Item
      title={word}
      subtitle={source.title}
      icon={Icon.Book}
      actions={
        <ActionPanel>
          <Action.Push
            title="Open Entry"
            icon={Icon.Book}
            target={<EntryScreen initialWord={word} initialSourceId={source.id} onLookedUp={onLookedUp} />}
          />
          <Action.OpenInBrowser
            title={`Open in ${source.shortTitle}`}
            url={source.entryUrl(word)}
            shortcut={Keyboard.Shortcut.Common.Open}
          />
          <Action.CopyToClipboard title="Copy Word" content={word} shortcut={Keyboard.Shortcut.Common.CopyName} />
        </ActionPanel>
      }
    />
  );
}

interface RecentRowProps {
  item: RecentLookup;
  sources: DictionarySource[];
  onLookedUp: () => void;
  onRemove: () => void;
}

function RecentRow({ item, sources, onLookedUp, onRemove }: RecentRowProps) {
  const source = findSource(sources, item.source);
  return (
    <List.Item
      title={item.word}
      subtitle={item.gloss}
      icon={Icon.Clock}
      accessories={[{ text: item.partOfSpeech }, { text: source?.shortTitle ?? item.source }]}
      actions={
        <ActionPanel>
          <Action.Push
            title="Open Entry"
            icon={Icon.Book}
            target={<EntryScreen initialWord={item.word} initialSourceId={item.source} onLookedUp={onLookedUp} />}
          />
          <Action.CopyToClipboard title="Copy Word" content={item.word} shortcut={Keyboard.Shortcut.Common.CopyName} />
          <Action
            title="Remove from Recent"
            icon={Icon.Trash}
            shortcut={Keyboard.Shortcut.Common.Remove}
            onAction={onRemove}
          />
        </ActionPanel>
      }
    />
  );
}

export default function SearchWordCommand(props: LaunchProps<{ launchContext?: SearchLaunchContext }>) {
  const preferences = useMemo(readPreferences, []);
  const sources = useMemo(() => availableSources(preferences), [preferences]);
  const [activeSourceId, setActiveSourceId] = useActiveSource(preferences.defaultSource);
  const activeSource = resolveSource(sources, activeSourceId, preferences.defaultSource);
  const [query, setQuery] = useState(props.launchContext?.word ?? "");
  const { push } = useNavigation();
  const { data: recent, isLoading, revalidate } = usePromise(listRecent, []);
  const launched = useRef(false);

  // Define Selected Word lands straight on the entry; the list stays underneath for Escape.
  useEffect(() => {
    const context = props.launchContext;
    if (!context?.word || launched.current) return;
    launched.current = true;
    push(<EntryScreen initialWord={context.word} substitutedFrom={context.substitutedFrom} onLookedUp={revalidate} />);
  }, [props.launchContext, push, revalidate]);

  const word = query.trim();
  const otherSources = sources.filter((source) => source.id !== activeSource.id);

  return (
    <List
      filtering={false}
      searchText={query}
      onSearchTextChange={setQuery}
      searchBarPlaceholder="Type a word"
      isLoading={isLoading}
      searchBarAccessory={
        <SourceDropdown sources={sources} value={activeSource.id} onChange={(id: SourceId) => setActiveSourceId(id)} />
      }
    >
      {word && (
        <List.Section title="Look Up">
          <LookupRow word={word} source={activeSource} onLookedUp={revalidate} />
        </List.Section>
      )}
      {word && otherSources.length > 0 && (
        <List.Section title="Also In">
          {otherSources.map((source) => (
            <LookupRow key={source.id} word={word} source={source} onLookedUp={revalidate} />
          ))}
        </List.Section>
      )}
      {recent && recent.length > 0 && (
        <List.Section title="Recent">
          {recent.map((item) => (
            <RecentRow
              key={`${item.source}:${item.word}`}
              item={item}
              sources={sources}
              onLookedUp={revalidate}
              onRemove={() => forgetLookup(item.word, item.source).then(revalidate)}
            />
          ))}
        </List.Section>
      )}
      <List.EmptyView
        icon={Icon.Book}
        title="Type a word to look it up"
        description={`Opens in ${activeSource.title}. Switch with ⌘P.`}
      />
    </List>
  );
}
