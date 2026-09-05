import { showToast, Toast } from "@raycast/api";
import type { AccentVariant, Entry, EntrySection } from "../model/entry";
import { findPronunciation } from "../model/entry";
import { VARIANT_NAMES } from "./titles";
import type { AppPreferences } from "../preferences";
import type { DictionarySource } from "../sources/types";
import { audioPlayer } from "./index";

/** Raycast hides whichever toast is on screen, so only the latest playback may hide its own toast. */
let latestPlayback = 0;

export { pronunciationActionTitle } from "./titles";

async function playWithFeedback(title: string, playback: () => Promise<void>): Promise<void> {
  const ticket = ++latestPlayback;
  const toast = await showToast({ style: Toast.Style.Animated, title });
  try {
    await playback();
    if (ticket === latestPlayback) await toast.hide();
  } catch (error) {
    toast.style = Toast.Style.Failure;
    toast.title = "Could not play the pronunciation";
    toast.message = error instanceof Error ? error.message : String(error);
  }
}

export async function pronounce(
  source: DictionarySource,
  entry: Entry,
  section: EntrySection,
  variant: AccentVariant,
  preferences: Pick<AppPreferences, "speakWhenNoRecording">,
): Promise<void> {
  const pronunciation = findPronunciation(section, variant);
  if (pronunciation?.audioUrl) {
    const url = pronunciation.audioUrl;
    await playWithFeedback(`Playing ${VARIANT_NAMES[variant]} pronunciation`, () => audioPlayer.play(url));
    return;
  }
  if (preferences.speakWhenNoRecording) {
    await playWithFeedback("Speaking with the macOS voice", () => audioPlayer.speak(entry.headword));
    return;
  }
  await showToast({
    style: Toast.Style.Failure,
    title: `No ${VARIANT_NAMES[variant]} recording in ${source.shortTitle}`,
    message: "Switch dictionaries with ⌘P or turn on the macOS voice in the extension preferences.",
  });
}
