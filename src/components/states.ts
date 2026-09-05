import type { LookupResult } from "../model/entry";
import type { DictionarySource } from "../sources/types";

/** Headline for any lookup outcome, in Title Case like Raycast's own empty states. */
export function lookupResultTitle(source: DictionarySource, word: string, result: LookupResult): string {
  if (result.status === "found") return result.entry.headword;
  if (result.status === "not-found") return `No Entry for “${word}” in ${source.shortTitle}`;
  switch (result.reason) {
    case "network":
      return `Couldn’t Reach ${source.shortTitle}`;
    case "blocked":
      return `${source.shortTitle} Refused the Request`;
    case "format-changed":
      return `${source.shortTitle} Page Format Changed`;
    case "missing-key":
      return `${source.shortTitle} Needs an API Key`;
    case "rejected-key":
      return `${source.shortTitle} Rejected the Key`;
  }
}
