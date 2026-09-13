import { environment } from "@raycast/api";
import path from "node:path";
import { httpClient } from "../http/client";
import type { HttpClient } from "../http/client";
import { curlClient } from "../http/curl-client";
import { createAudioPlayer } from "./player";

/** Collins serves its clips from the same host that turns Node's TLS fingerprint away, so those go through curl. */
const COLLINS_MEDIA_HOST = "api.collinsdictionary.com";

function clientFor(url: string): Pick<HttpClient, "fetchBytes"> {
  // The address comes out of parsed markup, so anything that is not a URL falls back rather than throwing.
  try {
    return new URL(url).host === COLLINS_MEDIA_HOST ? curlClient : httpClient;
  } catch {
    return httpClient;
  }
}

/** One player per extension process so a new clip replaces the one still playing. */
export const audioPlayer = createAudioPlayer({
  directory: path.join(environment.supportPath, "audio"),
  http: { fetchBytes: (url) => clientFor(url).fetchBytes(url) },
});
