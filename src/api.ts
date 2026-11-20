import type { ClientErrorCode, LevelDeltasData, Result } from "./types.js";

const BASE_URL = "https://moreinfo.lacycat.org";
const HANDLE_RE = /^[A-Za-z0-9_]{1,30}$/;
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

export async function fetchLevelDeltas(handle: string): Promise<Result<LevelDeltasData>> {
  if (!HANDLE_RE.test(handle)) return fail("INVALID_REQUEST", "Invalid handle.");

  let res: Response;
  try {
    res = await fetch(
      `${BASE_URL}/v1/users/${encodeURIComponent(handle)}/level-deltas`,
      { signal: AbortSignal.timeout(8000) }
    );
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

  const b = body as { error?: { code?: unknown }; data?: unknown } | null;

  if (!res.ok) {
    const code = b?.error?.code;
    const known = SERVER_CODES.find((c) => c === code);
    return fail(known ?? "UPSTREAM_ERROR", `Server returned ${res.status}.`);
  }

  const data = b?.data;
  if (!isLevelDeltasData(data)) return fail("BAD_RESPONSE", "Invalid data format.");
  return { ok: true, data };
}