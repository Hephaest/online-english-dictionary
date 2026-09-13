import { getPreferenceValues } from "@raycast/api";
import type { SourceId } from "./model/entry";
import type { CollinsCredentials, MerriamWebsterCredentials } from "./sources/types";

export interface AppPreferences {
  defaultSource: SourceId;
  merriamWebster?: MerriamWebsterCredentials;
  collins?: CollinsCredentials;
  speakWhenNoRecording: boolean;
}

export function readPreferences(): AppPreferences {
  const values = getPreferenceValues<Preferences>();
  const apiKey = values.merriamWebsterApiKey?.trim();
  const collinsApiKey = values.collinsApiKey?.trim();
  return {
    defaultSource: values.defaultSource,
    merriamWebster: apiKey ? { apiKey, reference: values.merriamWebsterDictionary } : undefined,
    collins: collinsApiKey ? { apiKey: collinsApiKey, dictionary: values.collinsDictionary } : undefined,
    speakWhenNoRecording: values.speakWhenNoRecording,
  };
}
