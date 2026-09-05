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
  // A miss or a failure for the current request; while it is undefined the previous entry, if any, stays on screen.
  const problem = current && result && result.status !== "found" ? result : undefined;
  const shownSource = findSource(sources, resultSourceId) ?? source;
  const rows = found ? rowsOf(found) : [];
  const note = substitutionNote(word, substitution);

  // A phrase that misses is retried as its longest word, once, and the pane says so.
  useEffect(() => {
    if (problem?.status !== "not-found" || !word.includes(" ") || substitution) return;
    const fallback = longestWord(word);
    if (fallback && fallback !== word) {
      setSubstitution(word);
      setWord(fallback);
    }
  }, [problem, word, substitution]);

  // On a new entry: remember it, then land on the row the reader was on, or the first row of the same part of speech.
  useEffect(() => {
    if (result?.status !== "found") return;
    const entry = result.entry;
    // Remembers the term looked up, never entry.headword or its part of speech: an entry's
    // content is the dictionary's own data, and API terms forbid keeping that on disk.
    // The term is normally typed, but a Did You Mean click makes it a word the source suggested;
    // a bare word is kept either way, unlike the definitions and examples around it.
    if (resultWord) {
      const key = `${entry.source}:${resultWord}`;
      if (rememberedKey.current !== key) {
        rememberedKey.current = key;
        rememberLookup({ word: resultWord, source: entry.source }).then(() => onLookedUp?.());
      }
    }
    const entryRows = rowsOf(entry);
    const previous = selectedRow.current;
    const sameRow = previous && entryRows.find((row) => row.id === previous.id);
    const samePartOfSpeech = previous && entryRows.find((row) => row.section.partOfSpeech === previous.partOfSpeech);
    setSelectedItemId((sameRow ?? samePartOfSpeech ?? entryRows[0])?.id);
  }, [result]);

  useEffect(() => {
    if (problem?.status !== "unavailable" || problem.reason !== "network") return;
    const next = neighborSource(sources, source.id, 1);
    showToast({
      style: Toast.Style.Failure,
      title: lookupResultTitle(source, word, problem),
      message: problem.message,
      primaryAction: { title: "Retry", onAction: () => refresh() },
      secondaryAction:
        next.id === source.id
          ? undefined
          : { title: `Switch to ${next.shortTitle}`, onAction: () => switchSource(next.id) },
    });
  }, [problem]);

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
                  <List.Item.Detail markdown={senseMarkdown(found, section, sense, { substitutionNote: note })} />
                }
                actions={
                  <EntryActions
                    source={shownSource}
                    entry={found}
                    section={section}
                    sense={sense}
                    preferences={preferences}
                  />
                }
              />
            ))}
          </List.Section>
        ))}
      {problem?.status === "not-found" && problem.suggestions.length > 0 && (
        <List.Section title="Did You Mean" subtitle={lookupResultTitle(source, word, problem)}>
          {problem.suggestions.map((suggestion) => (
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
      {/* Raycast hides every empty view while isLoading is true, so the loading bar alone covers the first fetch. */}
      {problem && (
        <List.EmptyView
          icon={problem.status === "not-found" ? Icon.MagnifyingGlass : Icon.ExclamationMark}
          title={lookupResultTitle(source, word, problem)}
          description={problem.status === "unavailable" ? problem.message : "Try another dictionary with ⌘P."}
          actions={
            <RecoveryActions
              source={source}
              word={word}
              onRefresh={refresh}
              showPreferences={
                problem.status === "unavailable" &&
                (problem.reason === "missing-key" || problem.reason === "rejected-key")
              }
              browserFirst={
                problem.status === "not-found" ||
                (problem.status === "unavailable" && problem.reason === "format-changed")
              }
            />
          }
        />
      )}
    </List>
  );
}
