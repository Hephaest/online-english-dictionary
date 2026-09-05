import { environment } from "@raycast/api";
import path from "node:path";
import { httpClient } from "../http/client";
import { createAudioPlayer } from "./player";

/** One player per extension process so a new clip replaces the one still playing. */
export const audioPlayer = createAudioPlayer({
  directory: path.join(environment.supportPath, "audio"),
  http: httpClient,
});
