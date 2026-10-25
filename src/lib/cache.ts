/**
 * Last-good cache in localStorage.
 *
 * The dashboard paints from cache on load and only overwrites an entry on a
 * successful fetch, so a worker being down degrades to stale-but-labelled data
 * rather than an empty panel.
 */

import { CACHE_PREFIX } from "../config";

export interface Cached<T> {
  data: T;
  savedAt: number;
}

export function readCache<T>(key: string): Cached<T> | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.savedAt !== "number") return null;
    return parsed as Cached<T>;
  } catch {
    return null;
  }
}

export function writeCache<T>(key: string, data: T): void {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ data, savedAt: Date.now() }));
  } catch {
    // Quota exceeded or storage disabled. The dashboard still works live.
  }
}

/** Human-readable age, e.g. "4m ago". */
export function ageLabel(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
