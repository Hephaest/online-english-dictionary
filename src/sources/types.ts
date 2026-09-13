import type { LookupResult, SourceId } from "../model/entry";

export type MerriamWebsterReference = "learners" | "collegiate";

export interface MerriamWebsterCredentials {
  apiKey: string;
  reference: MerriamWebsterReference;
}

export type CollinsDictionary = "english" | "english-learner" | "american-learner";

export interface CollinsCredentials {
  apiKey: string;
  dictionary: CollinsDictionary;
}

export interface LookupOptions {
  merriamWebster?: MerriamWebsterCredentials;
  collins?: CollinsCredentials;
}

export interface DictionarySource {
  id: SourceId;
  /** Full name, for the dropdown and the source tag on the search rows. */
  title: string;
  /** Short name for action titles such as "Open in Cambridge". */
  shortTitle: string;
  homepage: string;
  /** Set when the source cannot work without a user-supplied key. */
  requiresApiKey?: "merriamWebster" | "collins";
  /** Collins' terms forbid any storage that prevents a request being made, so its results are never cached. */
  cachingForbidden?: true;
  entryUrl(word: string): string;
  lookup(word: string, options: LookupOptions): Promise<LookupResult>;
}
