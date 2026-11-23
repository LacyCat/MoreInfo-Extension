import { isTagKey } from "./types.js";
import type {
  ClientErrorCode,
  HealthData,
  LevelDeltasData,
  Result,
  SetDeltasData,
  TagLevelDeltasData,
} from "./types.js";

const BASE_URL = "https://moreinfo.lacycat.org";
// 서버가 v2로 넘어가면 여기만 "v2"로 바꾸면 됨
const API_VERSION = "v2";
// set-deltas는 서버 스펙이 /v1/... 이라 API_VERSION과 따로 둠 (v2로 옮기면 이 값도 바꾸기)
const SET_API_VERSION = "v1";
// 서버의 Health 경로. API_VERSION을 v2로 바꿔도 서버가 /v1/health를 유지하는 동안은 그대로 둠
const HEALTH_PATH = "/v1/health";
export const HANDLE_RE = /^[A-Za-z0-9_]{1,30}$/;
const SERVER_CODES: ClientErrorCode[] = [
  "INVALID_REQUEST",
  "USER_NOT_FOUND",
  "RATE_LIMITED",
  "UPSTREAM_ERROR",
  "INTERNAL_ERROR",
];

function fail(
  code: ClientErrorCode,
  message: string,
  retryAfterSeconds?: number
): Result<never> {
  return { ok: false, code, message, retryAfterSeconds };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isLevelDeltasData(v: unknown): v is LevelDeltasData {
  if (typeof v !== "object" || v === null) return false;
  const d = v as Record<string, unknown>;
  const cur = d.current as Record<string, unknown> | null | undefined;
  return (
    typeof d.handle === "string" &&
    typeof cur === "object" &&
    cur !== null &&
    typeof cur.rating === "number" &&
    Array.isArray(d.deltaByLevel) &&
    d.deltaByLevel.length === 31 &&
    d.deltaByLevel.every((x) => typeof x === "number")
  );
}

function isTagLevelDeltasData(v: unknown): v is TagLevelDeltasData {
  if (!isRecord(v)) return false;
  if (typeof v.handle !== "string" || !isNum(v.level)) return false;
  if (!Array.isArray(v.tagDeltas)) return false;
  return v.tagDeltas.every((t: unknown) => {
    if (!isRecord(t) || !isRecord(t.delta)) return false;
    return (
      typeof t.key === "string" &&
      isNum(t.solvedCount) &&
      isNum(t.currentRating) &&
      isNum(t.predictedRating) &&
      isNum(t.delta.rating) &&
      isNum(t.delta.problemSum) &&
      isNum(t.delta.solvedBonus)
    );
  });
}

/** 2xx면 파싱된 JSON 본문을, 아니면 실패 Result를 돌려줌. */
async function requestJson(path: string, init: RequestInit = {}): Promise<Result<unknown>> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return fail("NETWORK_ERROR", "Failed to reach server.");
  }

  if (res.status === 429) {
    const retry = Number(res.headers.get("Retry-After"));
    return fail("RATE_LIMITED", "Too many requests.", retry > 0 ? retry : undefined);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return fail("BAD_RESPONSE", `Unexpected response (${res.status}).`);
  }

  if (!res.ok) {
    const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
    const known = SERVER_CODES.find((c) => c === code);
    return fail(known ?? "UPSTREAM_ERROR", `Server returned ${res.status}.`);
  }

  return { ok: true, data: body };
}

export async function fetchLevelDeltas(handle: string): Promise<Result<LevelDeltasData>> {
  if (!HANDLE_RE.test(handle)) return fail("INVALID_REQUEST", "Invalid handle.");

  const r = await requestJson(`/${API_VERSION}/users/${encodeURIComponent(handle)}/level-deltas`);
  if (!r.ok) return r;

  const data = (r.data as { data?: unknown } | null)?.data;
  if (!isLevelDeltasData(data)) return fail("BAD_RESPONSE", "Invalid data format.");
  return { ok: true, data };
}

/** { "data": {...} } 래핑이 있어도, 없어도 받아들임. */
function unwrapData(body: unknown): unknown {
  if (isRecord(body) && "data" in body) return body.data;
  return body;
}

export async function fetchTagLevelDeltas(
  handle: string,
  level: number,
  tags: readonly string[]
): Promise<Result<TagLevelDeltasData>> {
  if (!HANDLE_RE.test(handle)) return fail("INVALID_REQUEST", "Invalid handle.");
  if (!Number.isInteger(level) || level < 1 || level > 30) {
    return fail("INVALID_REQUEST", "Invalid level.");
  }
  const uniqueTags = [...new Set(tags)].sort();
  if (uniqueTags.length === 0 || !uniqueTags.every(isTagKey)) {
    return fail("INVALID_REQUEST", "Invalid tags.");
  }

  const r = await requestJson(
    `/${API_VERSION}/users/${encodeURIComponent(handle)}/tag-level-deltas`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ level, tags: uniqueTags }),
    }
  );
  if (!r.ok) return r;

  const data = unwrapData(r.data);
  if (!isTagLevelDeltasData(data)) return fail("BAD_RESPONSE", "Invalid data format.");
  return { ok: true, data };
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export async function fetchHealth(clientVersion: string): Promise<Result<HealthData>> {
  const r = await requestJson(HEALTH_PATH, {
    headers: { "X-Client-Version": clientVersion },
  });
  if (!r.ok) return r;

  const body = unwrapData(r.data);
  if (!isRecord(body)) return fail("BAD_RESPONSE", "Invalid data format.");

  const updateUrl = str(body.updateUrl);
  return {
    ok: true,
    data: {
      status: str(body.status),
      minClientVersion: str(body.minClientVersion),
      latestClientVersion: str(body.latestClientVersion),
      message: str(body.message),
      updateUrl: updateUrl?.startsWith("https://") ? updateUrl : undefined,
    },
  };
}

const SET_LEVEL_COUNT = 31; // 난이도 0~30
const MAX_SETS = 20;

function isSetDeltasData(v: unknown, setCount: number): v is SetDeltasData {
  if (!isRecord(v) || !isRecord(v.current) || !isNum(v.current.rating)) return false;
  return (
    Array.isArray(v.deltas) && v.deltas.length === setCount && v.deltas.every(isNum)
  );
}

/**
 * sets: 각 원소는 길이 31의 배열(인덱스=난이도, 값=그 난이도 문제 수).
 * 돌려주는 deltas[i]가 sets[i]를 모두 풀었을 때의 예상 레이팅 상승분.
 */
export async function fetchSetDeltas(
  handle: string,
  sets: number[][]
): Promise<Result<SetDeltasData>> {
  if (!HANDLE_RE.test(handle)) return fail("INVALID_REQUEST", "Invalid handle.");
  const validSets =
    sets.length >= 1 &&
    sets.length <= MAX_SETS &&
    sets.every(
      (set) =>
        Array.isArray(set) &&
        set.length === SET_LEVEL_COUNT &&
        set.every((n) => Number.isInteger(n) && n >= 0)
    );
  if (!validSets) return fail("INVALID_REQUEST", "Invalid sets.");

  const r = await requestJson(
    `/${SET_API_VERSION}/users/${encodeURIComponent(handle)}/set-deltas`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sets }),
    }
  );
  if (!r.ok) return r;

  const data = unwrapData(r.data);
  if (!isSetDeltasData(data, sets.length)) return fail("BAD_RESPONSE", "Invalid data format.");
  return { ok: true, data };
}