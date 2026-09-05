import { Action, ActionPanel, Icon, Keyboard, openExtensionPreferences } from "@raycast/api";
import { pronounce, pronunciationActionTitle } from "../audio/pronounce";
import type { Entry, EntrySection, Sense } from "../model/entry";
import { pictureForSense } from "../model/entry";
import { senseClipboardText } from "../model/markdown";
import type { AppPreferences } from "../preferences";
import { oedSearchUrl } from "../sources";
import type { DictionarySource } from "../sources/types";
import { PictureDetail } from "./PictureDetail";

interface RecoveryActionsProps {
  source: DictionarySource;
  word: string;
  onRefresh: () => void;
  /** Shown for key problems so the fix is one keystroke away. */
  showPreferences?: boolean;
  /** Open in Browser leads when retrying cannot help: a miss, or a page whose format changed. */
  browserFirst?: boolean;
}

/** Actions for the not-found and unavailable states; the dictionary itself is switched with the ⌘P dropdown. */
export function RecoveryActions({ source, word, onRefresh, showPreferences, browserFirst }: RecoveryActionsProps) {
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
      {browserFirst ? browser : retry}
      {showPreferences && (
        <Action title="Open Extension Preferences" icon={Icon.Key} onAction={() => openExtensionPreferences()} />
      )}
      {browserFirst ? retry : browser}
    </ActionPanel>
  );
}

interface EntryActionsProps {
  source: DictionarySource;
  entry: Entry;
  section: EntrySection;
  sense: Sense;
  preferences: Pick<AppPreferences, "speakWhenNoRecording">;
}

/** The selected meaning's actions: hear it, open it, see its picture, copy it. */
export function EntryActions({ source, entry, section, sense, preferences }: EntryActionsProps) {
  const picture = pictureForSense(section, sense);
  return (
    <ActionPanel>
      <ActionPanel.Section>
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
      <ActionPanel.Section>
        <Action.OpenInBrowser
          title={`Open in ${source.shortTitle}`}
          url={entry.url}
          shortcut={Keyboard.Shortcut.Common.Open}
        />
        <Action.OpenInBrowser title="Open in OED" url={oedSearchUrl(entry.headword)} icon={Icon.Globe} />
        {picture && (
          <Action.Push
            title="Show Picture"
            icon={Icon.Image}
            target={<PictureDetail entry={entry} picture={picture} />}
            shortcut={{ modifiers: ["cmd", "shift"], key: "i" }}
          />
        )}
      </ActionPanel.Section>
      <ActionPanel.Section>
        <Action.CopyToClipboard
          title="Copy Definition"
          content={senseClipboardText(entry, section, sense)}
          shortcut={Keyboard.Shortcut.Common.Copy}
        />
      </ActionPanel.Section>
    </ActionPanel>
  );
}
