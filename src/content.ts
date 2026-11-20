// 콘텐츠 스크립트는 일반 스크립트로 실행돼서 import/export를 쓸 수 없다.
// 그래서 타입과 티어 계산을 이 파일 안에 직접 둔다.
type DeltasResult =
  | { ok: true; data: { current: { rating: number }; deltaByLevel: number[] } }
  | { ok: false; code: string; message: string };

(() => {
  // ── 백준 페이지 구조에 의존하는 값: 사이트가 바뀌면 여기만 고친다 ──
  const TABLE_SELECTOR = "table#problemset";
  const TITLE_CELL_INDEX = 1; // 제목 칸 (두 번째 td)
  const TIER_IMG_SELECTOR = "img.solvedac-tier"; // 파일 이름이 난이도 (예: 8.svg)
  const SOLVED_LABEL_SELECTOR = ".problem-label-ac"; // "성공" 라벨
  const BADGE_CLASS = "boj-rating-delta";

  // ── 시험용: 숫자를 넣으면 그 레이팅인 것처럼 계산한다. 확인이 끝나면 null로 되돌린다 ──
  const TEST_RATING_OVERRIDE = 480 as number | null;
  // ── 티어 경계 (solved.ac 레이팅 표 기준). 숫자는 V, IV, III, II, I 순서 ──
  const TIER_MINS: ReadonlyArray<readonly [string, readonly number[]]> = [
    ["B", [30, 60, 90, 120, 150]],
    ["S", [200, 300, 400, 500, 650]],
    ["G", [800, 950, 1100, 1250, 1400]],
    ["P", [1600, 1750, 1900, 2000, 2100]],
    ["D", [2200, 2300, 2400, 2500, 2600]],
    ["R", [2700, 2800, 2850, 2900, 2950]],
  ];
  const TIER_STEPS: Array<{ min: number; label: string }> = [{ min: 0, label: "U" }];
  for (const [initial, mins] of TIER_MINS) {
    mins.forEach((min, i) => TIER_STEPS.push({ min, label: `${initial}${5 - i}` }));
  }
  TIER_STEPS.push({ min: 3000, label: "M" });

  // 레이팅 → 티어 약자 (예: 441 → "S3")
  function tierLabel(rating: number): string {
    let label = "U";
    for (const step of TIER_STEPS) {
      if (rating >= step.min) label = step.label;
      else break;
    }
    return label;
  }
    // 티어 약자 → 색. 마스터(M)와 언레이티드(U)는 색을 정해 두지 않아서 null이고, 주변 색을 그대로 쓴다
  const TIER_COLORS: Record<string, string> = {
    B: "#d6673b",
    S: "#5381a0",
    G: "#ffae35",
    P: "#1cd690",
    D: "#5387ff",
    R: "#ff217d",
  };
  function colorForLabel(label: string): string | null {
    return TIER_COLORS[label.charAt(0)] ?? null;
  }

  // 난이도(1~30) → 티어 색
  function colorForLevel(level: number): string | null {
    if (!Number.isInteger(level) || level < 1 || level > 30) return null;
    if (level <= 5) return "#d6673b"; // 브론즈
    if (level <= 10) return "#5381a0"; // 실버
    if (level <= 15) return "#ffae35"; // 골드
    if (level <= 20) return "#1cd690"; // 플래티넘
    if (level <= 25) return "#5387ff"; // 다이아
    return "#ff217d"; // 루비
  }

  function levelFromImg(img: HTMLImageElement | null): number | null {
    const m = /(-?\d+)\.svg(?:$|[?#])/.exec(img?.getAttribute("src") ?? "");
    return m && m[1] !== undefined ? Number(m[1]) : null;
  }

  // 로그인한 사용자의 핸들 (로그인하지 않았으면 null)
  function getHandle(): string | null {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="username"]');
    const handle = meta?.content.trim() ?? "";
    return /^[A-Za-z0-9_]{1,30}$/.test(handle) ? handle : null;
  }

  // change: 티어가 오를 때만 "S3 -> S2" 형태의 문자열, 아니면 null
    // change가 있으면 "+N (이전 -> 이후)". 괄호와 화살표는 문제 티어 색, 티어 약자는 각자의 티어 색
  function makeBadge(
    delta: number,
    color: string,
    change: { before: string; after: string } | null
  ): HTMLSpanElement {
    const el = document.createElement("span");
    el.className = BADGE_CLASS;
    el.style.cssText =
      `float:right;margin-left:12px;font-weight:bold;white-space:nowrap;color:${color};`;

    const tierSpan = (label: string): HTMLSpanElement => {
      const s = document.createElement("span");
      s.textContent = label;
      const c = colorForLabel(label);
      if (c !== null) s.style.color = c;
      return s;
    };

    el.append(`+${delta}`);
    if (change) {
      el.append(" (", tierSpan(change.before), " ➜ ", tierSpan(change.after), ")");
      el.title = `이 문제를 풀면 예상 레이팅 +${delta}, 티어 ${change.before} -> ${change.after}`;
    } else {
      el.title = `이 문제를 풀면 예상 레이팅 +${delta}`;
    }
    return el;
  }

  async function main(): Promise<void> {
    const table = document.querySelector<HTMLTableElement>(TABLE_SELECTOR);
    if (!table) return;

    const handle = getHandle();
    if (!handle) return;

    let res: DeltasResult | undefined;
    try {
      res = (await chrome.runtime.sendMessage({
        type: "GET_LEVEL_DELTAS",
        handle,
      })) as DeltasResult | undefined;
    } catch {
      return;
    }
    if (!res || !res.ok) {
      console.debug("[BOJ Rating Preview]", res && !res.ok ? res.code : "no response");
      return;
    }
    const deltas = res.data.deltaByLevel;
    const currentRating = TEST_RATING_OVERRIDE ?? res.data.current.rating;
    const before = tierLabel(currentRating);

    for (const row of Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody tr"))) {
      const cell = row.cells[TITLE_CELL_INDEX];
      if (!cell || cell.querySelector(`.${BADGE_CLASS}`)) continue; // 이미 붙인 행
      if (row.querySelector(SOLVED_LABEL_SELECTOR)) continue; // 푼 문제는 표시 안 함

      const level = levelFromImg(cell.querySelector<HTMLImageElement>(TIER_IMG_SELECTOR));
      if (level === null) continue;
      const color = colorForLevel(level);
      const delta = deltas[level];
      if (color === null || delta === undefined) continue;

      const after = tierLabel(currentRating + delta);
      const change = after !== before ? { before, after } : null;

      cell.prepend(makeBadge(delta, color, change)); // float:right라서 제목 칸 오른쪽 끝에 놓인다
    }
  }

  void main();
})();