import type { AccentVariant, Entry, EntrySection, Pronunciation, Sense } from "./entry";
import { findPronunciation, pictureForSense } from "./entry";

/** Owner-set constant: fits the detail pane without a horizontal scroll. */
export const PICTURE_WIDTH = 340;

const VARIANT_ORDER: AccentVariant[] = ["us", "uk"];

export function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_{}[\]<>#+!|])/g, "\\$1");
}

function pronunciationText(pronunciation: Pronunciation): string {
  if (!pronunciation.text) return "";
  return pronunciation.notation === "respelling" ? `\\${pronunciation.text}\\` : `/${pronunciation.text}/`;
}

/** One line such as `us /ˈkɪtʃɪn/ · uk /ˈkɪtʃɪn/ *(no audio)*`, US first. */
export function pronunciationLine(section: EntrySection): string {
  const parts = VARIANT_ORDER.map((variant) => {
    const pronunciation = findPronunciation(section, variant);
    if (!pronunciation) return undefined;
    const text = pronunciationText(pronunciation);
    const audioNote = pronunciation.audioUrl ? "" : " *(no audio)*";
    return `${variant} ${text}${audioNote}`.trim();
  });
  return parts.filter(Boolean).join(" · ");
}

function pictureMarkdown(sense: Sense, section: EntrySection, sizeHints = true): string[] {
  const picture = pictureForSense(section, sense);
  if (!picture) return [];
  const url = picture.fullUrl ?? picture.thumbUrl;
  const separator = url.includes("?") ? "&" : "?";
  const sized = sizeHints ? `${url}${separator}raycast-width=${PICTURE_WIDTH}` : url;
  const lines = [`![${escapeMarkdown(picture.caption ?? section.title)}](${sized})`];
  if (picture.caption) lines.push(`*${escapeMarkdown(picture.caption)}*`);
  if (picture.credit) lines.push(`*Photo: ${escapeMarkdown(picture.credit)}*`);
  return lines;
}

function senseHeading(sense: Sense): string {
  const cefr = sense.cefr ? `**${sense.cefr}** ` : "";
  const heading = sense.heading ? `**${escapeMarkdown(sense.heading)}** ` : "";
  const labels = sense.labels.map((label) => `\`${label.text}\``).join(" ");
  return `${cefr}**${sense.number}.** ${heading}${escapeMarkdown(sense.definition)}${labels ? ` ${labels}` : ""}`;
}

function exampleLines(sense: Sense): string[] {
  return sense.examples.map((example) => `> ${escapeMarkdown(example)}`);
}

/** Markdown for the right-hand pane of the entry screen: one sense in full. */
export function senseMarkdown(
  entry: Entry,
  section: EntrySection,
  sense: Sense,
  options: { substitutionNote?: string } = {},
): string {
  const lines: string[] = [`# ${escapeMarkdown(entry.headword)}`, ""];
  if (options.substitutionNote) lines.push(`*${escapeMarkdown(options.substitutionNote)}*`, "");
  const pronunciation = pronunciationLine(section);
  if (pronunciation) lines.push(pronunciation, "");
  const badges = [section.partOfSpeech, ...section.badges.map((badge) => badge.text)].filter((text): text is string =>
    Boolean(text),
  );
  if (badges.length > 0) lines.push(badges.map(escapeMarkdown).join(" · "), "");
  lines.push(senseHeading(sense), "");
  const picture = pictureMarkdown(sense, section);
  if (picture.length > 0) lines.push(...picture, "");
  const examples = exampleLines(sense);
  if (examples.length > 0) lines.push(...examples, "");
  if (sense.note) lines.push(`*${escapeMarkdown(sense.note)}*`, "");
  return lines.join("\n").trimEnd();
}

/** Markdown for the full-width reading page: every section and sense. */
export function entryMarkdown(
  entry: Entry,
  options: { substitutionNote?: string; forClipboard?: boolean } = {},
): string {
  const sizeHints = !options.forClipboard;
  const lines: string[] = [`# ${escapeMarkdown(entry.headword)}`, ""];
  if (options.substitutionNote) lines.push(`*${escapeMarkdown(options.substitutionNote)}*`, "");
  for (const section of entry.sections) {
    lines.push(`## ${escapeMarkdown(section.title)}`, "");
    const pronunciation = pronunciationLine(section);
    if (pronunciation) lines.push(pronunciation, "");
    if (section.badges.length > 0)
      lines.push(section.badges.map((badge) => escapeMarkdown(badge.text)).join(" · "), "");
    if (section.picture && section.senses[0]) {
      lines.push(...pictureMarkdown({ ...section.senses[0], picture: undefined }, section, sizeHints), "");
    }
    for (const sense of section.senses) {
      lines.push(senseHeading(sense), "");
      if (sense.picture) lines.push(...pictureMarkdown(sense, { ...section, picture: undefined }, sizeHints), "");
      const examples = exampleLines(sense);
      if (examples.length > 0) lines.push(...examples, "");
      if (sense.note) lines.push(`*${escapeMarkdown(sense.note)}*`, "");
    }
  }
  return lines.join("\n").trimEnd();
}

/** Plain text for the clipboard: definition and examples of one sense. */
export function senseClipboardText(entry: Entry, section: EntrySection, sense: Sense): string {
  const heading = [entry.headword, section.partOfSpeech].filter(Boolean).join(" · ");
  const examples = sense.examples.map((example) => `  - ${example}`);
  return [heading, sense.definition, ...examples].join("\n");
}

/** Plain text for the clipboard: every definition of the entry, grouped by section. */
export function entryClipboardText(entry: Entry): string {
  const lines: string[] = [entry.headword];
  for (const section of entry.sections) {
    lines.push("", section.title);
    for (const sense of section.senses) lines.push(`${sense.number}. ${sense.definition}`);
  }
  return lines.join("\n");
}

/** One line per transcription, for the Copy IPA action; empty when the source prints none. */
export function pronunciationClipboardText(section: EntrySection): string {
  return section.pronunciations
    .filter((pronunciation) => pronunciation.text)
    .map((pronunciation) => `${pronunciation.variant.toUpperCase()} ${pronunciationText(pronunciation)}`)
    .join("\n");
}
