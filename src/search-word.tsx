import {
  Action,
  ActionPanel,
  closeMainWindow,
  Icon,
  Keyboard,
  LaunchProps,
  List,
  PopToRootType,
  useNavigation,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useEffect, useMemo, useRef, useState } from "react";
import { sourceTag } from "./components/accessories";
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
      icon={Icon.Book}
      accessories={[sourceTag(source)]}
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
        </ActionPanel>
      }
    />
  );
}

interface RecentRowProps {
  item: RecentLookup;
  source: DictionarySource;
  onLookedUp: () => void;
  onRemove: () => void;
}

function RecentRow({ item, source, onLookedUp, onRemove }: RecentRowProps) {
  return (
    <List.Item
      title={item.word}
      icon={Icon.Clock}
      accessories={[sourceTag(source)]}
      actions={
        <ActionPanel>
          <Action.Push
            title="Open Entry"
            icon={Icon.Book}
            target={<EntryScreen initialWord={item.word} initialSourceId={item.source} onLookedUp={onLookedUp} />}
          />
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

  // Define Selected Word lands straight on the entry; Escape there closes Raycast instead of revealing this list.
  useEffect(() => {
    const context = props.launchContext;
    if (!context?.word || launched.current) return;
    launched.current = true;
    push(
      <EntryScreen initialWord={context.word} substitutedFrom={context.substitutedFrom} onLookedUp={revalidate} />,
      () => void closeMainWindow({ popToRootType: PopToRootType.Immediate }),
    );
  }, [props.launchContext, push, revalidate]);

  const word = query.trim();
  const otherSources = sources.filter((source) => source.id !== activeSource.id);
  // A word looked up in a dictionary that is hidden today (Merriam-Webster without its key) waits until that dictionary is back.
  const openableRecent = (recent ?? []).flatMap((item) => {
    const source = findSource(sources, item.source);
    return source ? [{ item, source }] : [];
  });

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
      {!word && openableRecent.length > 0 && (
        <List.Section title="Recent">
          {openableRecent.map(({ item, source }) => (
            <RecentRow
              key={`${item.source}:${item.word}`}
              item={item}
              source={source}
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
