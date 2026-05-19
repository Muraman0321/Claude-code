import { del, get, set } from "idb-keyval";

const PREFIX = "glider:v1:";
const DEFAULT_TTL_MS = 5 * 60 * 1000;

interface Envelope<T> {
  ts: number;
  value: T;
}

export async function cacheGet<T>(key: string, ttlMs = DEFAULT_TTL_MS): Promise<T | undefined> {
  try {
    const env = (await get(PREFIX + key)) as Envelope<T> | undefined;
    if (!env) return undefined;
    if (Date.now() - env.ts > ttlMs) {
      void del(PREFIX + key);
      return undefined;
    }
    return env.value;
  } catch {
    return undefined;
  }
}

export async function cacheSet<T>(key: string, value: T): Promise<void> {
  try {
    await set(PREFIX + key, { ts: Date.now(), value } satisfies Envelope<T>);
  } catch {
    // Quota or private mode — silently skip; the source of truth is Supabase.
  }
}

export async function cacheClear(key: string): Promise<void> {
  try {
    await del(PREFIX + key);
  } catch {
    // ignore
  }
}
