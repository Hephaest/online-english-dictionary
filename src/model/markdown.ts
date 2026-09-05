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

function pictureMarkdown(sense: Sense, section: EntrySection): string[] {
  const picture = pictureForSense(section, sense);
  if (!picture) return [];
  const url = picture.fullUrl ?? picture.thumbUrl;
  const separator = url.includes("?") ? "&" : "?";
  const lines = [
    `![${escapeMarkdown(picture.caption ?? section.title)}](${url}${separator}raycast-width=${PICTURE_WIDTH})`,
  ];
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

/** Plain text for the clipboard: definition and examples of one sense. */
export function senseClipboardText(entry: Entry, section: EntrySection, sense: Sense): string {
  const heading = [entry.headword, section.partOfSpeech].filter(Boolean).join(" · ");
  const examples = sense.examples.map((example) => `  - ${example}`);
  return [heading, sense.definition, ...examples].join("\n");
}
