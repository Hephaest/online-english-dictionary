import { useCachedState } from "@raycast/utils";
import type { SourceId } from "../model/entry";

/** The dictionary both commands agree on; persisted in the extension cache so the choice survives between runs. */
export function useActiveSource(fallback: SourceId) {
  return useCachedState<SourceId>("active-source", fallback);
}
