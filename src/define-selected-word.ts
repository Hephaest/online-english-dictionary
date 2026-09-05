import { Clipboard, getSelectedText, launchCommand, LaunchType, showToast, Toast } from "@raycast/api";
import { chooseLookupTarget, cleanSelection, MAX_PHRASE_WORDS } from "./text/words";
import type { LookupTarget } from "./text/words";

/** The frontmost app's selection first; the clipboard only when it holds a short phrase, never a long text reduced to one word. */
async function readTarget(): Promise<LookupTarget | undefined> {
  try {
    const selected = await getSelectedText();
    if (selected.trim()) return chooseLookupTarget(selected);
  } catch {
    // Nothing selected: fall through to the clipboard.
  }
  const clipboard = cleanSelection((await Clipboard.readText()) ?? "");
  if (!clipboard || clipboard.split(" ").length > MAX_PHRASE_WORDS) return undefined;
  return { word: clipboard };
}

export default async function DefineSelectedWordCommand() {
  const target = await readTarget();
  if (!target) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Nothing to look up",
      message: "Select a word, or copy a short phrase, then run the command again.",
    });
    return;
  }
  try {
    await launchCommand({
      name: "search-word",
      type: LaunchType.UserInitiated,
      context: { word: target.word, substitutedFrom: target.substitutedFrom },
    });
  } catch (error) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Could not open Search Word",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
