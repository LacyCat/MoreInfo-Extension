import { fetchLevelDeltas } from "./api.js";
import type { GetLevelDeltasMessage, LevelDeltasData, Result } from "./types.js";

// 확장 쪽 캐시 유지 시간: Worker 캐시(2분)보다 짧게
const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  savedAt: number;
  data: LevelDeltasData;
}

// 같은 핸들 요청이 동시에 여러 개 와도 서버에는 한 번만 보낸다
const inflight = new Map<string, Promise<Result<LevelDeltasData>>>();

async function getLevelDeltasCached(handle: string): Promise<Result<LevelDeltasData>> {
  const key = `deltas:${handle.toLowerCase()}`;

  // storage.session은 브라우저를 닫으면 사라지고, 서비스 워커가 꺼져도 유지된다
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
    return result; // 실패는 저장하지 않는다
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
  if (sender.id !== chrome.runtime.id) return false; // 이 확장의 메시지만 받는다
  if (!isGetLevelDeltas(message)) return false;

  void getLevelDeltasCached(message.handle).then(sendResponse);
  return true; // 응답을 비동기로 보낸다는 뜻 (빼먹으면 응답이 안 간다)
});
