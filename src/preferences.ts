import { getPreferenceValues } from "@raycast/api";
import type { SourceId } from "./model/entry";
import type { MerriamWebsterCredentials } from "./sources/types";

export interface AppPreferences {
  defaultSource: SourceId;
  merriamWebster?: MerriamWebsterCredentials;
  speakWhenNoRecording: boolean;
}

export function readPreferences(): AppPreferences {
  const values = getPreferenceValues<Preferences>();
  const apiKey = values.merriamWebsterApiKey?.trim();
  return {
    defaultSource: values.defaultSource,
    merriamWebster: apiKey ? { apiKey, reference: values.merriamWebsterDictionary } : undefined,
    speakWhenNoRecording: values.speakWhenNoRecording,
  };
}
