import type { LookupResult, SourceId } from "../model/entry";

export type MerriamWebsterReference = "learners" | "collegiate";

export interface MerriamWebsterCredentials {
  apiKey: string;
  reference: MerriamWebsterReference;
}

export interface LookupOptions {
  merriamWebster?: MerriamWebsterCredentials;
}

export interface DictionarySource {
  id: SourceId;
  /** Full name, for the dropdown and the metadata panel. */
  title: string;
  /** Short name for action titles such as "Open in Cambridge". */
  shortTitle: string;
  homepage: string;
  /** Set when the source cannot work without a user-supplied key. */
  requiresApiKey?: "merriamWebster";
  entryUrl(word: string): string;
  lookup(word: string, options: LookupOptions): Promise<LookupResult>;
}
