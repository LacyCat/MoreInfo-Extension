import {
  fetchHealth,
  fetchLevelDeltas,
  fetchSetDeltas,
  fetchTagLevelDeltas,
  HANDLE_RE,
} from "./api.js";
import type {
  GetCachedTagDeltasMessage,
  GetHealthMessage,
  GetLevelDeltasMessage,
  GetSetDeltasMessage,
  GetTagLevelDeltasMessage,
  HealthData,
  HealthStatus,
  LevelDeltasData,
  Result,
  SetDeltasData,
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

/* ---------------- Health / 버전 확인 ---------------- */

const HEALTH_CACHE_KEY = "healthCheck";
const HEALTH_TTL_OK_MS = 6 * 60 * 60 * 1000; // 성공 결과는 6시간 재사용
const HEALTH_TTL_FAIL_MS = 5 * 60 * 1000; // 실패는 5분 뒤 재시도

interface HealthCacheEntry {
  savedAt: number;
  clientVersion: string; // 확장이 업데이트되면 캐시 무효화
  result: Result<HealthStatus>;
}

let healthInflight: Promise<Result<HealthStatus>> | null = null;

/** "1.2.3" 형태만 비교. 해석 못 하면 null. */
function parseVersion(v: string): number[] | null {
  if (!/^\d+(\.\d+){0,3}$/.test(v)) return null;
  return v.split(".").map(Number);
}

/** a가 b보다 낮으면 true. 어느 한쪽이라도 해석 못 하면 false(알림 안 띄움). */
function isOlder(a: string, b: string): boolean {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return false;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

function toHealthStatus(data: HealthData, clientVersion: string): HealthStatus {
  const min = data.minClientVersion ?? null;
  const latest = data.latestClientVersion ?? null;
  const updateRequired = min !== null && isOlder(clientVersion, min);
  const updateAvailable = !updateRequired && latest !== null && isOlder(clientVersion, latest);
  return {
    clientVersion,
    minClientVersion: min,
    latestClientVersion: latest,
    updateRequired,
    updateAvailable,
    message: data.message ?? null,
    updateUrl: data.updateUrl ?? null,
  };
}

async function getHealthCached(): Promise<Result<HealthStatus>> {
  const clientVersion = chrome.runtime.getManifest().version;

  try {
    const stored = await chrome.storage.local.get(HEALTH_CACHE_KEY);
    const entry = stored[HEALTH_CACHE_KEY] as HealthCacheEntry | undefined;
    if (entry && entry.clientVersion === clientVersion) {
      const ttl = entry.result.ok ? HEALTH_TTL_OK_MS : HEALTH_TTL_FAIL_MS;
      if (Date.now() - entry.savedAt < ttl) return entry.result;
    }
  } catch {
    // 저장소를 못 읽어도 그냥 새로 확인
  }

  if (healthInflight) return healthInflight;

  healthInflight = (async () => {
    const res = await fetchHealth(clientVersion);
    const result: Result<HealthStatus> = res.ok
      ? { ok: true, data: toHealthStatus(res.data, clientVersion) }
      : res;
    const saved: HealthCacheEntry = { savedAt: Date.now(), clientVersion, result };
    await chrome.storage.local.set({ [HEALTH_CACHE_KEY]: saved }).catch(() => undefined);
    return result;
  })().finally(() => {
    healthInflight = null;
  });
  return healthInflight;
}

function isGetHealth(m: unknown): m is GetHealthMessage {
  return typeof m === "object" && m !== null && (m as Record<string, unknown>).type === "GET_HEALTH";
}

/* ---------------- 문제집 총 상승 레이팅 (set-deltas) ---------------- */

const SET_TTL_MS = 60_000; // 같은 문제집을 연달아 열어도 1분은 재사용
const setInflight = new Map<string, Promise<Result<SetDeltasData>>>();

async function getSetDeltasCached(msg: GetSetDeltasMessage): Promise<Result<SetDeltasData>> {
  const key = `setdeltas:${msg.handle.toLowerCase()}:${JSON.stringify(msg.sets)}`;

  const stored = await chrome.storage.session.get(key);
  const entry = stored[key] as { savedAt: number; data: SetDeltasData } | undefined;
  if (entry && Date.now() - entry.savedAt < SET_TTL_MS) return { ok: true, data: entry.data };

  const pending = setInflight.get(key);
  if (pending) return pending;

  const request = (async () => {
    const result = await fetchSetDeltas(msg.handle, msg.sets);
    if (result.ok) {
      await chrome.storage.session
        .set({ [key]: { savedAt: Date.now(), data: result.data } })
        .catch(() => undefined);
    }
    return result;
  })().finally(() => setInflight.delete(key));

  setInflight.set(key, request);
  return request;
}

function isGetSetDeltas(m: unknown): m is GetSetDeltasMessage {
  if (typeof m !== "object" || m === null) return false;
  const o = m as Record<string, unknown>;
  return (
    o.type === "GET_SET_DELTAS" &&
    typeof o.handle === "string" &&
    Array.isArray(o.sets) &&
    o.sets.every((set) => Array.isArray(set) && set.every((n) => typeof n === "number"))
  );
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

  if (isGetHealth(message)) {
    void getHealthCached().then(sendResponse);
    return true;
  }
  if (isGetSetDeltas(message)) {
    void getSetDeltasCached(message).then(sendResponse);
    return true;
  }
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