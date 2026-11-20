
export interface LevelDeltasData {
  handle: string;
  current: { rating: number };
  deltaByLevel: number[]; 
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