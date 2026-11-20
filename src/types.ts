// Worker가 주는 난이도별 증가량 (확장에서 쓰는 필드만)
export interface LevelDeltasData {
  handle: string;
  current: { rating: number };
  deltaByLevel: number[]; // 길이 31, 인덱스 = 난이도(1~30)
}

export type ClientErrorCode =
  | "INVALID_REQUEST"
  | "USER_NOT_FOUND"
  | "RATE_LIMITED"
  | "UPSTREAM_ERROR"
  | "INTERNAL_ERROR"
  | "NETWORK_ERROR" // 서버에 연결 실패
  | "BAD_RESPONSE"; // 응답이 JSON이 아니거나 형식이 다름

// 성공이면 data, 실패면 code와 message (예외를 던지지 않고 결과로 돌려준다)
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; code: ClientErrorCode; message: string; retryAfterSeconds?: number };

// 콘텐츠 스크립트 → 백그라운드 메시지
export interface GetLevelDeltasMessage {
  type: "GET_LEVEL_DELTAS";
  handle: string;
}