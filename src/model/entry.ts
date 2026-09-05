/**
 * Identifiers of the dictionaries the extension can read.
 * The one list every other list is derived from, so adding a dictionary here reaches all of them at once.
 */
export const SOURCE_IDS = ["cambridge", "longman", "oxford-learners", "merriam-webster", "urban"] as const;

export type SourceId = (typeof SOURCE_IDS)[number];

export type AccentVariant = "us" | "uk";

/** How a pronunciation is written: true IPA, or a publisher's own respelling such as Merriam-Webster's. */
export type PronunciationNotation = "ipa" | "respelling";

export interface Pronunciation {
  variant: AccentVariant;
  /** Transcription without surrounding slashes. */
  text?: string;
  notation?: PronunciationNotation;
  /** Absolute URL read from the source. Never synthesized from the word. */
  audioUrl?: string;
  /** True when the clip is machine-generated speech rather than a recording. */
  synthesized?: boolean;
}

export interface Picture {
  thumbUrl: string;
  fullUrl?: string;
  /** What the picture shows, when the source prints one. */
  caption?: string;
  /** Rights line the source prints, for example a photo agency. */
  credit?: string;
}

export type BadgeKind = "cefr" | "frequency" | "register" | "grammar" | "region" | "label" | "votes";

export interface Badge {
  kind: BadgeKind;
  text: string;
}

export interface Sense {
  /** Stable within one entry; used as the list row id. */
  id: string;
  /** Short heading such as "1", "1.2", or a sense number the source prints. */
  number: string;
  /** Guideword some sources print above a sense, such as Cambridge's "GO QUICKLY". */
  heading?: string;
  definition: string;
  examples: string[];
  labels: Badge[];
  cefr?: string;
  picture?: Picture;
  /** Free text the source attaches, for example an Urban Dictionary author line. */
  note?: string;
}

/** One block of an entry: a homograph, a dictionary within a page, or a part-of-speech group. */
export interface EntrySection {
  id: string;
  /** Heading shown above the senses, for example "noun" or "British English · noun". */
  title: string;
  partOfSpeech?: string;
  pronunciations: Pronunciation[];
  badges: Badge[];
  senses: Sense[];
  /** Picture the source attaches to the whole section rather than to one sense. */
  picture?: Picture;
}

export interface Entry {
  source: SourceId;
  headword: string;
  /** Page the user can open in the browser. */
  url: string;
  sections: EntrySection[];
}

export type UnavailableReason = "missing-key" | "rejected-key" | "network" | "blocked" | "format-changed";

export type LookupResult =
  | { status: "found"; entry: Entry }
  | { status: "not-found"; suggestions: string[] }
  | { status: "unavailable"; reason: UnavailableReason; message: string };

export function findPronunciation(section: EntrySection, variant: AccentVariant): Pronunciation | undefined {
  return section.pronunciations.find((pronunciation) => pronunciation.variant === variant);
}

/** The picture a sense shows: its own, or the section picture on the first sense only. */
export function pictureForSense(section: EntrySection, sense: Sense): Picture | undefined {
  if (sense.picture) return sense.picture;
  return section.senses[0]?.id === sense.id ? section.picture : undefined;
}
