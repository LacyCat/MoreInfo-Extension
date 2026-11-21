export interface LevelDeltasData {
  handle: string;
  current: { rating: number };
  deltaByLevel: number[]; 
}

/**
 * 서버가 이해하는 태그 키. (content.ts는 classic script라 import를 못 해서
 * 같은 목록이 content.ts의 TAG_NAME_TO_KEY에도 있음 — 바꿀 땐 같이 바꿀 것)
 */
export const TAG_KEYS = [
  "math",
  "impl",
  "dp",
  "greedy",
  "string",
  "graph",
  "geom",
  "ds",
] as const;

export type TagKey = (typeof TAG_KEYS)[number];

export function isTagKey(v: unknown): v is TagKey {
  return typeof v === "string" && (TAG_KEYS as readonly string[]).includes(v);
}

export interface TagDelta {
  key: string;
  solvedCount: number;
  currentRating: number;
  predictedRating: number;
  delta: {
    rating: number;
    problemSum: number;
    solvedBonus: number;
  };
}

export interface TagLevelDeltasData {
  handle: string;
  level: number;
  tagDeltas: TagDelta[];
}

/** 문제 하나에 대해 캐시된 태그별 예측. level/tagsKey가 바뀌면 무효. */
export interface TagCacheEntry {
  level: number;
  tagsKey: string; // 정렬된 태그 키를 ","로 이은 값
  savedAt: number;
  data: TagLevelDeltasData;
}

/** problemId(문자열) -> 엔트리 */
export type TagCache = Record<string, TagCacheEntry>;

/** GET /health 응답에서 클라이언트가 읽는 필드 (전부 선택) */
export interface HealthData {
  status?: string;
  minClientVersion?: string; // 이 버전 미만은 더 이상 동작을 보장하지 않음
  latestClientVersion?: string; // 최신 버전 (이보다 낮으면 선택적 업데이트 안내)
  message?: string; // 팝업에 그대로 보여줄 안내 문구
  updateUrl?: string; // https:// 만 허용
}

/** 클라이언트 버전과 비교해 계산한 결과 (content script로 전달) */
export interface HealthStatus {
  clientVersion: string;
  minClientVersion: string | null;
  latestClientVersion: string | null;
  updateRequired: boolean;
  updateAvailable: boolean;
  message: string | null;
  updateUrl: string | null;
}

export type ClientErrorCode =
  | "INVALID_REQUEST"
  | "USER_NOT_FOUND"
  | "RATE_LIMITED"
  | "UPSTREAM_ERROR"
  | "INTERNAL_ERROR"
  | "NETWORK_ERROR" 
  | "BAD_RESPONSE";


export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; code: ClientErrorCode; message: string; retryAfterSeconds?: number };

export interface GetLevelDeltasMessage {
  type: "GET_LEVEL_DELTAS";
  handle: string;
}

export interface GetTagLevelDeltasMessage {
  type: "GET_TAG_LEVEL_DELTAS";
  handle: string;
  problemId: number;
  level: number;
  tags: string[];
}

export interface GetCachedTagDeltasMessage {
  type: "GET_CACHED_TAG_DELTAS";
  handle: string;
}

export interface GetHealthMessage {
  type: "GET_HEALTH";
}