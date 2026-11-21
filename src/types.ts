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