import { Action, ActionPanel, Icon, List, showToast, Toast } from "@raycast/api";
import { useEffect, useMemo, useRef, useState } from "react";
import { useActiveSource } from "../hooks/useActiveSource";
import { useLookup } from "../hooks/useLookup";
import { normalizeWord } from "../lookup";
import type { Entry, EntrySection, Sense, SourceId } from "../model/entry";
import { pictureForSense } from "../model/entry";
import { senseMarkdown } from "../model/markdown";
import { readPreferences } from "../preferences";
import { rememberLookup } from "../recent";
import { availableSources, findSource, neighborSource, resolveSource } from "../sources";
import { longestWord } from "../text/words";
import { EntryActions, RecoveryActions } from "./EntryActions";
import { EntryMetadata } from "./EntryMetadata";
import { FullEntry } from "./FullEntry";
import { SourceDropdown } from "./SourceDropdown";
import { lookupResultTitle } from "./states";

interface EntryScreenProps {
  initialWord: string;
  initialSourceId?: SourceId;
  /** The original text when a shorter word was looked up instead. */
  substitutedFrom?: string;
  onLookedUp?: () => void;
}

interface SenseRow {
  id: string;
  section: EntrySection;
  sense: Sense;
}

function rowsOf(entry: Entry): SenseRow[] {
  return entry.sections.flatMap((section) =>
    section.senses.map((sense) => ({ id: `${section.id}:${sense.id}`, section, sense })),
  );
}

function substitutionNote(word: string, substitutedFrom: string | undefined): string | undefined {
  return substitutedFrom ? `Looked up “${word}” instead of “${substitutedFrom}”.` : undefined;
}

/** The entry screen: the word's meanings on the left, grouped by role, and the selected meaning on the right. */
export function EntryScreen({ initialWord, initialSourceId, substitutedFrom, onLookedUp }: EntryScreenProps) {
  const preferences = useMemo(readPreferences, []);
  const sources = useMemo(() => availableSources(preferences), [preferences]);
  const [activeSourceId, setActiveSourceId] = useActiveSource(preferences.defaultSource);
  const [sourceId, setSourceId] = useState<SourceId>(
    () => resolveSource(sources, initialSourceId, activeSourceId, preferences.defaultSource).id,
  );
  const source = resolveSource(sources, sourceId, preferences.defaultSource);
  const [word, setWord] = useState(initialWord);
  const [substitution, setSubstitution] = useState(substitutedFrom);
  const { result, resultSourceId, resultWord, isLoading, refresh } = useLookup(
    source,
    word,
    preferences.merriamWebster,
  );
  const [selectedItemId, setSelectedItemId] = useState<string>();
  const selectedRow = useRef<{ id: string; partOfSpeech: string | undefined } | undefined>(undefined);
  const rememberedKey = useRef<string | undefined>(undefined);

  function switchSource(id: SourceId) {
    setSourceId(id);
    setActiveSourceId(id);
  }

  function lookUpSuggestion(suggestion: string) {
    setSubstitution(undefined);
    setWord(suggestion);
  }

  // The result belongs to the current request only once its source and word match; before that it is the previous entry.
  const current = resultSourceId === source.id && resultWord === normalizeWord(word);
  const found = result?.status === "found" ? result.entry : undefined;
  const shownSource = findSource(sources, resultSourceId) ?? source;
  const rows = found ? rowsOf(found) : [];
  const note = substitutionNote(word, substitution);

  // A phrase that misses is retried as its longest word, once, and the pane says so.
  useEffect(() => {
    if (!current || result?.status !== "not-found" || !word.includes(" ") || substitution) return;
    const fallback = longestWord(word);
    if (fallback && fallback !== word) {
      setSubstitution(word);
      setWord(fallback);
    }
  }, [current, result, word, substitution]);

  // On a new entry: remember it, then land on the row the reader was on, or the first row of the same part of speech.
  useEffect(() => {
    if (result?.status !== "found") return;
    const entry = result.entry;
    const key = `${entry.source}:${entry.headword}`;
    if (rememberedKey.current !== key) {
      rememberedKey.current = key;
      const first = entry.sections[0];
      rememberLookup({
        word: entry.headword,
        source: entry.source,
        partOfSpeech: first?.partOfSpeech,
        gloss: first?.senses[0]?.definition,
      }).then(() => onLookedUp?.());
    }
    const entryRows = rowsOf(entry);
    const previous = selectedRow.current;
    const sameRow = previous && entryRows.find((row) => row.id === previous.id);
    const samePartOfSpeech = previous && entryRows.find((row) => row.section.partOfSpeech === previous.partOfSpeech);
    setSelectedItemId((sameRow ?? samePartOfSpeech ?? entryRows[0])?.id);
  }, [result]);

  useEffect(() => {
    if (!current || result?.status !== "unavailable" || result.reason !== "network") return;
    const next = neighborSource(sources, source.id, 1);
    showToast({
      style: Toast.Style.Failure,
      title: lookupResultTitle(source, word, result),
      message: result.message,
      primaryAction: { title: "Retry", onAction: () => refresh() },
      secondaryAction:
        next.id === source.id
          ? undefined
          : { title: `Switch to ${next.shortTitle}`, onAction: () => switchSource(next.id) },
    });
  }, [current, result]);

  const showState = current && result && result.status !== "found";

  return (
    <List
      navigationTitle={initialWord}
      isLoading={isLoading}
      isShowingDetail={Boolean(found)}
      searchBarPlaceholder="Filter meanings"
      selectedItemId={selectedItemId}
      onSelectionChange={(id) => {
        const row = rows.find((candidate) => candidate.id === id);
        if (row) selectedRow.current = { id: row.id, partOfSpeech: row.section.partOfSpeech };
      }}
      searchBarAccessory={<SourceDropdown sources={sources} value={source.id} onChange={switchSource} />}
    >
      {found &&
        found.sections.map((section) => (
          <List.Section key={section.id} title={section.title}>
            {section.senses.map((sense) => (
              <List.Item
                key={`${section.id}:${sense.id}`}
                id={`${section.id}:${sense.id}`}
                title={`${sense.number}. ${sense.heading ? `${sense.heading}: ` : ""}${sense.definition}`}
                icon={pictureForSense(section, sense) ? Icon.Image : Icon.Text}
                detail={
                  <List.Item.Detail
                    markdown={senseMarkdown(found, section, sense, { substitutionNote: note })}
                    metadata={<EntryMetadata source={shownSource} entry={found} section={section} sense={sense} />}
                  />
                }
                actions={
                  <EntryActions
                    source={shownSource}
                    sources={sources}
                    entry={found}
                    section={section}
                    sense={sense}
                    preferences={preferences}
                    onSwitchSource={switchSource}
                    onRefresh={refresh}
                    fullEntry={
                      <FullEntry
                        word={word}
                        sourceId={shownSource.id}
                        substitutionNote={note}
                        onSwitchSource={switchSource}
                      />
                    }
                  />
                }
              />
            ))}
          </List.Section>
        ))}
      {showState && result.status === "not-found" && result.suggestions.length > 0 && (
        <List.Section title="Did You Mean" subtitle={lookupResultTitle(source, word, result)}>
          {result.suggestions.map((suggestion) => (
            <List.Item
              key={suggestion}
              title={suggestion}
              icon={Icon.Text}
              actions={
                <ActionPanel>
                  <Action title="Open Entry" icon={Icon.Book} onAction={() => lookUpSuggestion(suggestion)} />
                  <Action.OpenInBrowser title={`Open in ${source.shortTitle}`} url={source.entryUrl(suggestion)} />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}
      {showState && (
        <List.EmptyView
          icon={result.status === "not-found" ? Icon.MagnifyingGlass : Icon.ExclamationMark}
          title={lookupResultTitle(source, word, result)}
          description={result.status === "unavailable" ? result.message : "Try another dictionary with ⌘] or ⌘⇧D."}
          actions={
            <RecoveryActions
              source={source}
              sources={sources}
              word={word}
              onSwitchSource={switchSource}
              onRefresh={refresh}
              showPreferences={
                result.status === "unavailable" && (result.reason === "missing-key" || result.reason === "rejected-key")
              }
              browserFirst={
                result.status === "not-found" || (result.status === "unavailable" && result.reason === "format-changed")
              }
            />
          }
        />
      )}
    </List>
  );
}
