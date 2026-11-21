import { fetchLevelDeltas, fetchTagLevelDeltas, HANDLE_RE } from "./api.js";
import type {
  GetCachedTagDeltasMessage,
  GetLevelDeltasMessage,
  GetTagLevelDeltasMessage,
  LevelDeltasData,
  Result,
  TagCache,
  TagCacheEntry,
  TagLevelDeltasData,
} from "./types.js";

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

/* ---------------- 태그별 변화량 캐시 ---------------- */

// 유저별로 키 하나에 {problemId -> 엔트리}를 통째로 저장 (목록 페이지에서 한 번에 읽기 위함)
const TAG_CACHE_MAX_ENTRIES = 500;

const tagInflight = new Map<string, Promise<Result<TagLevelDeltasData>>>();
let tagWriteChain: Promise<unknown> = Promise.resolve();

function tagCacheKey(handle: string): string {
  return `tagDeltaCache:${handle.toLowerCase()}`;
}

async function readTagCache(handle: string): Promise<TagCache> {
  const key = tagCacheKey(handle);
  try {
    const stored = await chrome.storage.local.get(key);
    return (stored[key] as TagCache | undefined) ?? {};
  } catch {
    return {};
  }
}

// read-modify-write가 겹쳐서 서로 덮어쓰지 않도록 한 줄로 세움
function saveTagEntry(handle: string, problemId: number, entry: TagCacheEntry): Promise<void> {
  const run = tagWriteChain.then(async () => {
    const cache = await readTagCache(handle);
    cache[String(problemId)] = entry;

    const ids = Object.keys(cache);
    if (ids.length > TAG_CACHE_MAX_ENTRIES) {
      ids
        .sort((a, b) => (cache[a]?.savedAt ?? 0) - (cache[b]?.savedAt ?? 0))
        .slice(0, ids.length - TAG_CACHE_MAX_ENTRIES)
        .forEach((id) => delete cache[id]);
    }
    await chrome.storage.local.set({ [tagCacheKey(handle)]: cache });
  });
  tagWriteChain = run.catch(() => undefined);
  return run;
}

async function getTagLevelDeltasCached(
  msg: GetTagLevelDeltasMessage
): Promise<Result<TagLevelDeltasData>> {
  const tags = [...new Set(msg.tags)].sort();
  const tagsKey = tags.join(",");

  // 난이도와 태그가 그대로면 재사용
  const cache = await readTagCache(msg.handle);
  const hit = cache[String(msg.problemId)];
  if (hit && hit.level === msg.level && hit.tagsKey === tagsKey) {
    return { ok: true, data: hit.data };
  }

  const flightKey = `${msg.handle.toLowerCase()}:${msg.problemId}:${msg.level}:${tagsKey}`;
  const pending = tagInflight.get(flightKey);
  if (pending) return pending;

  const request = (async () => {
    const result = await fetchTagLevelDeltas(msg.handle, msg.level, tags);
    if (result.ok) {
      const saved: TagCacheEntry = {
        level: msg.level,
        tagsKey,
        savedAt: Date.now(),
        data: result.data,
      };
      await saveTagEntry(msg.handle, msg.problemId, saved).catch(() => undefined);
    }
    return result;
  })().finally(() => tagInflight.delete(flightKey));

  tagInflight.set(flightKey, request);
  return request;
}

function isGetLevelDeltas(m: unknown): m is GetLevelDeltasMessage {
  if (typeof m !== "object" || m === null) return false;
  const o = m as Record<string, unknown>;
  return o.type === "GET_LEVEL_DELTAS" && typeof o.handle === "string";
}

function isGetTagLevelDeltas(m: unknown): m is GetTagLevelDeltasMessage {
  if (typeof m !== "object" || m === null) return false;
  const o = m as Record<string, unknown>;
  return (
    o.type === "GET_TAG_LEVEL_DELTAS" &&
    typeof o.handle === "string" &&
    Number.isInteger(o.problemId) &&
    Number.isInteger(o.level) &&
    Array.isArray(o.tags) &&
    o.tags.every((t) => typeof t === "string")
  );
}

function isGetCachedTagDeltas(m: unknown): m is GetCachedTagDeltasMessage {
  if (typeof m !== "object" || m === null) return false;
  const o = m as Record<string, unknown>;
  return (
    o.type === "GET_CACHED_TAG_DELTAS" &&
    typeof o.handle === "string" &&
    HANDLE_RE.test(o.handle)
  );
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false; 

  if (isGetLevelDeltas(message)) {
    void getLevelDeltasCached(message.handle).then(sendResponse);
    return true;
  }
  if (isGetTagLevelDeltas(message)) {
    void getTagLevelDeltasCached(message).then(sendResponse);
    return true;
  }
  if (isGetCachedTagDeltas(message)) {
    void readTagCache(message.handle).then((data) => sendResponse({ ok: true, data }));
    return true;
  }
  return false;
});