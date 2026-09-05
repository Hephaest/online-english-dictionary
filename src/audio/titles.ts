import type { AccentVariant, EntrySection } from "../model/entry";
import { findPronunciation } from "../model/entry";
import type { DictionarySource } from "../sources/types";

export const VARIANT_NAMES: Record<AccentVariant, string> = { us: "US", uk: "UK" };

/** Title for a play action: honest about text-to-speech clips and about variants the source does not have. */
export function pronunciationActionTitle(
  source: DictionarySource,
  section: EntrySection,
  variant: AccentVariant,
): string {
  const pronunciation = findPronunciation(section, variant);
  if (pronunciation?.audioUrl && pronunciation.synthesized) return "Play Pronunciation (Text to Speech)";
  if (pronunciation?.audioUrl) return `Play ${VARIANT_NAMES[variant]} Pronunciation`;
  return `Play ${VARIANT_NAMES[variant]} Pronunciation (Not in ${source.shortTitle})`;
}
