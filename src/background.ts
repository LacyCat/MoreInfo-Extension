import { fetchLevelDeltas } from "./api.js";
import type { GetLevelDeltasMessage, LevelDeltasData, Result } from "./types.js";

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  savedAt: number;
  data: LevelDeltasData;
}

const inflight = new Map<string, Promise<Result<LevelDeltasData>>>();

async function getLevelDeltasCached(handle: string): Promise<Result<LevelDeltasData>> {
  const key = `deltas:${handle.toLowerCase()}`;

  const stored = await chrome.storage.session.get(key);
  const entry = stored[key] as CacheEntry | undefined;
  if (entry && Date.now() - entry.savedAt < CACHE_TTL_MS) {
    return { ok: true, data: entry.data };
  }

  const pending = inflight.get(key);
  if (pending) return pending;

  const request = (async () => {
    const result = await fetchLevelDeltas(handle);
    if (result.ok) {
      const saved: CacheEntry = { savedAt: Date.now(), data: result.data };
      await chrome.storage.session.set({ [key]: saved });
    }
    return result; 
  })().finally(() => inflight.delete(key));

  inflight.set(key, request);
  return request;
}

function isGetLevelDeltas(m: unknown): m is GetLevelDeltasMessage {
  if (typeof m !== "object" || m === null) return false;
  const o = m as Record<string, unknown>;
  return o.type === "GET_LEVEL_DELTAS" && typeof o.handle === "string";
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false; 
  if (!isGetLevelDeltas(message)) return false;

  void getLevelDeltasCached(message.handle).then(sendResponse);
  return true; 
});
