import { LocalStorage } from "@raycast/api";
import { z } from "zod";
import type { SourceId } from "./model/entry";

/** Owner-set constant: rows shown under RECENT when the search bar is empty. */
export const RECENT_LIMIT = 20;
const STORAGE_KEY = "recent-lookups";

const recentLookupSchema = z.object({
  word: z.string().min(1),
  source: z.enum(["cambridge", "longman", "oxford-learners", "merriam-webster", "urban"]),
  partOfSpeech: z.string().optional(),
  /** First sense, one line, so the row can carry a gloss without storing the entry. */
  gloss: z.string().optional(),
  lookedUpAt: z.string(),
});

export type RecentLookup = z.infer<typeof recentLookupSchema> & { source: SourceId };

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
