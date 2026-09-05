import { Action, ActionPanel, Clipboard, Icon, Keyboard, openExtensionPreferences, showHUD } from "@raycast/api";
import type { ReactElement, ReactNode } from "react";
import { pronounce, pronunciationActionTitle } from "../audio/pronounce";
import type { Entry, EntrySection, Sense, SourceId } from "../model/entry";
import { pictureForSense } from "../model/entry";
import { entryClipboardText, entryMarkdown, pronunciationClipboardText, senseClipboardText } from "../model/markdown";
import type { AppPreferences } from "../preferences";
import { neighborSource, oedSearchUrl } from "../sources";
import type { DictionarySource } from "../sources/types";
import { PictureDetail } from "./PictureDetail";

interface SourceActionsProps {
  source: DictionarySource;
  sources: DictionarySource[];
  onSwitchSource: (id: SourceId) => void;
}

/** Switch Source submenu plus the two in-place cycling actions; shared by the entry screens and their empty states. */
export function SourceActions({ source, sources, onSwitchSource }: SourceActionsProps) {
  return (
    <>
      <ActionPanel.Submenu
        title="Switch Source…"
        icon={Icon.Switch}
        shortcut={{ modifiers: ["cmd", "shift"], key: "d" }}
      >
        {sources.map((candidate) => (
          <Action
            key={candidate.id}
            title={candidate.title}
            icon={candidate.id === source.id ? Icon.Check : Icon.Book}
            onAction={() => onSwitchSource(candidate.id)}
          />
        ))}
      </ActionPanel.Submenu>
      {sources.length > 1 && (
        <>
          <Action
            title="Next Source"
            icon={Icon.ChevronRight}
            shortcut={{ modifiers: ["cmd"], key: "]" }}
            onAction={() => onSwitchSource(neighborSource(sources, source.id, 1).id)}
          />
          <Action
            title="Previous Source"
            icon={Icon.ChevronLeft}
            shortcut={{ modifiers: ["cmd"], key: "[" }}
            onAction={() => onSwitchSource(neighborSource(sources, source.id, -1).id)}
          />
        </>
      )}
    </>
  );
}

interface RecoveryActionsProps extends SourceActionsProps {
  word: string;
  onRefresh: () => void;
  /** Shown for key problems so the fix is one keystroke away. */
  showPreferences?: boolean;
  /** Open in Browser leads when retrying cannot help: a miss, or a page whose format changed. */
  browserFirst?: boolean;
}

/** Actions for the not-found and unavailable states. */
export function RecoveryActions({
  source,
  sources,
  word,
  onSwitchSource,
  onRefresh,
  showPreferences,
  browserFirst,
}: RecoveryActionsProps) {
  const browser = (
    <Action.OpenInBrowser
      title={`Open in ${source.shortTitle}`}
      url={source.entryUrl(word)}
      shortcut={Keyboard.Shortcut.Common.Open}
    />
  );
  const retry = (
    <Action title="Retry" icon={Icon.ArrowClockwise} shortcut={Keyboard.Shortcut.Common.Refresh} onAction={onRefresh} />
  );
  return (
    <ActionPanel>
      <ActionPanel.Section>
        {browserFirst ? browser : retry}
        {showPreferences && (
          <Action title="Open Extension Preferences" icon={Icon.Key} onAction={() => openExtensionPreferences()} />
        )}
        <SourceActions source={source} sources={sources} onSwitchSource={onSwitchSource} />
        {browserFirst ? retry : browser}
      </ActionPanel.Section>
    </ActionPanel>
  );
}

interface EntryActionsProps extends SourceActionsProps {
  entry: Entry;
  section: EntrySection;
  /** The selected meaning on the entry screen; absent on the full entry page. */
  sense?: Sense;
  preferences: AppPreferences;
  onRefresh: () => void;
  /** Action.Push target for Open Full Entry; absent when already on that page. */
  fullEntry?: ReactElement;
  /** Screen-specific view actions such as Hide Metadata. */
  viewActions?: ReactNode;
}

async function copyLazily(title: string, produce: () => string): Promise<void> {
  await Clipboard.copy(produce());
  await showHUD(`Copied ${title}`);
}

export function EntryActions(props: EntryActionsProps) {
  const { source, sources, entry, section, sense, preferences, onSwitchSource, onRefresh, fullEntry, viewActions } =
    props;
  const picture = sense ? pictureForSense(section, sense) : section.picture;
  const transcription = pronunciationClipboardText(section);
  const transcriptionTitle = section.pronunciations.every((pronunciation) => pronunciation.notation !== "respelling")
    ? "Copy IPA"
    : "Copy Pronunciation";
  return (
    <ActionPanel>
      <ActionPanel.Section title="Pronunciation">
        <Action
          title={pronunciationActionTitle(source, section, "us")}
          icon={Icon.SpeakerHigh}
          shortcut={{ modifiers: ["cmd"], key: "1" }}
          onAction={() => pronounce(source, entry, section, "us", preferences)}
        />
        <Action
          title={pronunciationActionTitle(source, section, "uk")}
          icon={Icon.SpeakerHigh}
          shortcut={{ modifiers: ["cmd"], key: "2" }}
          onAction={() => pronounce(source, entry, section, "uk", preferences)}
        />
      </ActionPanel.Section>
      <ActionPanel.Section title="Dictionary">
        <SourceActions source={source} sources={sources} onSwitchSource={onSwitchSource} />
      </ActionPanel.Section>
      <ActionPanel.Section title="Open">
        <Action.OpenInBrowser
          title={`Open in ${source.shortTitle}`}
          url={entry.url}
          shortcut={Keyboard.Shortcut.Common.Open}
        />
        <Action.OpenInBrowser title="Open in OED" url={oedSearchUrl(entry.headword)} icon={Icon.Globe} />
      </ActionPanel.Section>
      <ActionPanel.Section title="Copy">
        {sense ? (
          <Action.CopyToClipboard
            title="Copy Definition"
            content={senseClipboardText(entry, section, sense)}
            shortcut={Keyboard.Shortcut.Common.Copy}
          />
        ) : (
          <Action
            title="Copy All Definitions"
            icon={Icon.Clipboard}
            shortcut={Keyboard.Shortcut.Common.Copy}
            onAction={() => copyLazily("all definitions", () => entryClipboardText(entry))}
          />
        )}
        <Action.CopyToClipboard
          title="Copy Word"
          content={entry.headword}
          shortcut={Keyboard.Shortcut.Common.CopyName}
        />
        {transcription && (
          <Action.CopyToClipboard
            title={transcriptionTitle}
            content={transcription}
            shortcut={{ modifiers: ["cmd", "shift"], key: "t" }}
          />
        )}
        <Action
          title="Copy Entry as Markdown"
          icon={Icon.Clipboard}
          shortcut={{ modifiers: ["cmd", "shift"], key: "m" }}
          onAction={() => copyLazily("entry as Markdown", () => entryMarkdown(entry, { forClipboard: true }))}
        />
      </ActionPanel.Section>
      <ActionPanel.Section title="View">
        {fullEntry && (
          <Action.Push
            title="Open Full Entry"
            icon={Icon.Document}
            target={fullEntry}
            shortcut={{ modifiers: ["cmd", "shift"], key: "enter" }}
          />
        )}
        {picture && (
          <Action.Push
            title="Show Picture"
            icon={Icon.Image}
            target={<PictureDetail entry={entry} picture={picture} />}
            shortcut={{ modifiers: ["cmd", "shift"], key: "i" }}
          />
        )}
        {viewActions}
        <Action
          title="Refresh Entry"
          icon={Icon.ArrowClockwise}
          shortcut={Keyboard.Shortcut.Common.Refresh}
          onAction={onRefresh}
        />
      </ActionPanel.Section>
    </ActionPanel>
  );
}
