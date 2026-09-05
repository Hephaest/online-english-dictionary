import { LocalStorage } from "@raycast/api";
import { z } from "zod";
import { SOURCE_IDS } from "./model/entry";
import type { SourceId } from "./model/entry";

/** Owner-set constant: rows shown under RECENT when the search bar is empty. */
export const RECENT_LIMIT = 20;
const STORAGE_KEY = "recent-lookups";

/**
 * Only what the reader typed, the dictionary they chose, and when.
 * Nothing parsed out of a response is stored: dictionary API terms forbid keeping their data on disk.
 */
const recentLookupSchema = z.object({
  word: z.string().min(1),
  source: z.enum(SOURCE_IDS),
  lookedUpAt: z.string(),
});

export type RecentLookup = z.infer<typeof recentLookupSchema>;

/** Rows that no longer match the stored shape are dropped rather than rendered with missing titles. */
async function readAll(): Promise<RecentLookup[]> {
  const raw = await LocalStorage.getItem<string>(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((row) => {
      const result = recentLookupSchema.safeParse(row);
      return result.success ? [result.data] : [];
    });
  } catch {
    return [];
  }
}

export async function listRecent(): Promise<RecentLookup[]> {
  return readAll();
}

export async function rememberLookup(lookup: Omit<RecentLookup, "lookedUpAt">): Promise<void> {
  const others = (await readAll()).filter((item) => !(item.word === lookup.word && item.source === lookup.source));
  const next = [{ ...lookup, lookedUpAt: new Date().toISOString() }, ...others].slice(0, RECENT_LIMIT);
  await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export async function forgetLookup(word: string, source: SourceId): Promise<void> {
  const remaining = (await readAll()).filter((item) => !(item.word === word && item.source === source));
  await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(remaining));
}
