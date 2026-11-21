// content script는 classic script라 import를 쓸 수 없음 → 타입은 여기서 따로 선언
type DeltasResult =
  | { ok: true; data: { current: { rating: number }; deltaByLevel: number[] } }
  | { ok: false; code: string; message: string };

interface TagDeltaItem {
  key: string;
  solvedCount: number;
  currentRating: number;
  predictedRating: number;
  delta: { rating: number; problemSum: number; solvedBonus: number };
}
interface TagLevelDeltasData {
  handle: string;
  level: number;
  tagDeltas: TagDeltaItem[];
}
type TagDeltasResult =
  | { ok: true; data: TagLevelDeltasData }
  | { ok: false; code: string; message: string };

interface CachedTagEntry {
  level: number;
  tagsKey: string;
  data: TagLevelDeltasData;
}
type CachedTagMap = Record<string, CachedTagEntry>;
type CachedTagResult =
  | { ok: true; data: CachedTagMap }
  | { ok: false; code: string; message: string };

(() => {

  const TABLE_SELECTOR = "table#problemset";
  const TITLE_CELL_INDEX = 1; 
  const TIER_IMG_SELECTOR = "img.solvedac-tier"; 
  const SOLVED_LABEL_SELECTOR = ".problem-label-ac"; 

  const PROBLEM_TITLE_SELECTOR = "#problem_title";
  const PROBLEM_MENU_IMG_SELECTOR = ".problem-menu img.solvedac-tier";
  // 문제 페이지의 "알고리즘 분류" 링크들 (href가 절대/상대 경로 어느 쪽이든 매칭)
  const PROBLEM_TAG_SELECTOR = '#problem_tags a[href*="/problem/tag/"]';
  // 목록 표의 문제 번호 칸
  const LIST_PROBLEM_ID_SELECTOR = "td.list_problem_id";

  const BADGE_CLASS = "boj-rating-delta";

  const TEST_RATING_OVERRIDE = null as number | null;

  /* ---------------- 태그 ---------------- */

  // BOJ에 표시되는 이름 -> 서버 태그 키 (types.ts의 TAG_KEYS와 같은 목록)
  const TAG_NAME_TO_KEY = new Map<string, string>([
    ["수학", "math"],
    ["구현", "impl"],
    ["다이나믹 프로그래밍", "dp"],
    ["그리디 알고리즘", "greedy"],
    ["문자열", "string"],
    ["그래프 이론", "graph"],
    ["기하학", "geom"],
    ["자료 구조", "ds"],
  ]);
  const squash = (s: string): string => s.replace(/\s+/g, "");
  const TAG_KEY_BY_SQUASHED = new Map<string, string>(
    Array.from(TAG_NAME_TO_KEY, ([name, key]) => [squash(name), key] as [string, string])
  );
  const TAG_NAME_BY_KEY = new Map<string, string>(
    Array.from(TAG_NAME_TO_KEY, ([name, key]) => [key, name] as [string, string])
  );

  /**
   * 태그 아이콘 SVG path (viewBox 0 0 24 24 기준). 나중에 d 값만 채우면 됨.
   *   - path 하나: "M..."          - 여러 개: ["M...", "M..."]
   *   - 아이콘별로 그리기 방식을 바꾸려면: { d: "M...", mode: "fill" }
   * 비어 있으면 빈 칸(슬롯)만 보임.
   */
  type IconMode = "stroke" | "fill";
  type IconDef = string | string[] | { d: string | string[]; mode?: IconMode };

  const TAG_ICON_PATHS: Record<string, IconDef> = {
    math: ["M3 19a2 2 0 0 0 2 2c2 0 2 -4 3 -9s1 -9 3 -9a2 2 0 0 1 2 2", "M5 12h6", "M15 12l6 6", "M15 18l6 -6"],
    impl: ["M11.414 10l-7.383 7.418a2.091 2.091 0 0 0 0 2.967a2.11 2.11 0 0 0 2.976 0l7.407 -7.385", "M18.121 15.293l2.586 -2.586a1 1 0 0 0 0 -1.414l-7.586 -7.586a1 1 0 0 0 -1.414 0l-2.586 2.586a1 1 0 0 0 0 1.414l7.586 7.586a1 1 0 0 0 1.414 0"],
    dp: ["M4 13a8 8 0 0 1 7 7a6 6 0 0 0 3 -5a9 9 0 0 0 6 -8a3 3 0 0 0 -3 -3a9 9 0 0 0 -8 6a6 6 0 0 0 -5 3", "M7 14a6 6 0 0 0 -3 6a6 6 0 0 0 6 -3", "M14 9a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"],
    greedy: ["M15 11v.01", "M5.173 8.378a3 3 0 1 1 4.656 -1.377", "M16 4v3.803a6.019 6.019 0 0 1 2.658 3.197h1.341a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-1.342c-.336 .95 -.907 1.8 -1.658 2.473v2.027a1.5 1.5 0 0 1 -3 0v-.583a6.04 6.04 0 0 1 -1 .083h-4a6.04 6.04 0 0 1 -1 -.083v.583a1.5 1.5 0 0 1 -3 0v-2l0 -.027a6 6 0 0 1 4 -10.473h2.5l4.5 -3"],
    string: ["M3 16v-6a2 2 0 1 1 4 0v6", "M3 13h4", "M10 8v6a2 2 0 1 0 4 0v-1a2 2 0 1 0 -4 0v1", "M20.732 12a2 2 0 0 0 -3.732 1v1a2 2 0 0 0 3.726 1.01"],
    graph: ["M14 6a2 2 0 1 0 -4 0a2 2 0 0 0 4 0", "M7 14a2 2 0 1 0 -4 0a2 2 0 0 0 4 0", "M21 14a2 2 0 1 0 -4 0a2 2 0 0 0 4 0", "M14 18a2 2 0 1 0 -4 0a2 2 0 0 0 4 0", "M12 8v8", "M6.316 12.496l4.368 -4.992", "M17.684 12.496l-4.366 -4.99"],
    geom: ["M5 4h14a1 1 0 0 1 1 1v5a1 1 0 0 1 -1 1h-7a1 1 0 0 0 -1 1v7a1 1 0 0 1 -1 1h-5a1 1 0 0 1 -1 -1v-14a1 1 0 0 1 1 -1", "M4 8l2 0", "M4 12l3 0", "M4 16l2 0", "M8 4l0 2", "M12 4l0 3", "M16 4l0 2"],
    ds: ["M4 6a8 3 0 1 0 16 0a8 3 0 1 0 -16 0", "M4 6v6a8 3 0 0 0 16 0v-6", "M4 12v6a8 3 0 0 0 16 0v-6"],
  };
  const ICON_VIEWBOX = "0 0 24 24";
  // stroke: 선 아이콘(Lucide/Feather/Tabler 계열) — fill=none, stroke=currentColor
  // fill:   면 아이콘(Material/FontAwesome 계열) — fill=currentColor
  const ICON_DEFAULT_MODE: IconMode = "stroke";
  const ICON_STROKE_WIDTH = 2; // stroke 모드일 때 선 굵기 (viewBox 24 기준)
  const ICON_SLOT_PX = 28; // 아이콘 칸
  const ICON_SVG_PX = 20; // 칸 안의 실제 SVG 크기

  const HOVER_DELAY_MS = 200; // 스치듯 지나갈 때 요청이 나가지 않게 하는 지연

  /* ---------------- 티어 ---------------- */

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

  function tierLabel(rating: number): string {
    let label = "U";
    for (const step of TIER_STEPS) {
      if (rating >= step.min) label = step.label;
      else break;
    }
    return label;
  }

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


  function colorForLevel(level: number): string | null {
    if (!Number.isInteger(level) || level < 1 || level > 30) return null;
    if (level <= 5) return "#d6673b"; 
    if (level <= 10) return "#5381a0"; 
    if (level <= 15) return "#ffae35"; 
    if (level <= 20) return "#1cd690"; 
    if (level <= 25) return "#5387ff"; 
    return "#ff217d"; 
  }

  function levelFromImg(img: HTMLImageElement | null): number | null {
    const m = /(-?\d+)\.svg(?:$|[?#])/.exec(img?.getAttribute("src") ?? "");
    return m && m[1] !== undefined ? Number(m[1]) : null;
  }


  function getHandle(): string | null {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="username"]');
    const handle = meta?.content.trim() ?? "";
    return /^[A-Za-z0-9_]{1,30}$/.test(handle) ? handle : null;
  }

  function problemIdFromPage(): number | null {
    const fromPath = /\/problem\/(\d+)/.exec(location.pathname);
    if (fromPath && fromPath[1] !== undefined) return Number(fromPath[1]);

    // 경로로 못 읽으면 문제 메뉴("1000번" 탭)의 링크에서 읽음
    for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>(".problem-menu a"))) {
      const m = /\/problem\/(\d+)\/?$/.exec(a.pathname);
      if (m && m[1] !== undefined) return Number(m[1]);
    }
    return null;
  }

  function problemIdFromRow(row: HTMLTableRowElement): number | null {
    const text = row.querySelector(LIST_PROBLEM_ID_SELECTOR)?.textContent?.trim() ?? "";
    return /^\d+$/.test(text) ? Number(text) : null;
  }

  function readTagKeys(): string[] {
    const keys = new Set<string>();
    for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>(PROBLEM_TAG_SELECTOR))) {
      const key = TAG_KEY_BY_SQUASHED.get(squash(a.textContent ?? ""));
      if (key) keys.add(key);
    }
    return Array.from(keys).sort();
  }


  /* ---------------- 백그라운드 통신 ---------------- */

  async function send<T>(message: unknown): Promise<T | undefined> {
    try {
      return (await chrome.runtime.sendMessage(message)) as T | undefined;
    } catch {
      return undefined;
    }
  }

  async function requestTagDeltas(
    handle: string,
    problemId: number,
    level: number,
    tags: string[]
  ): Promise<TagDeltasResult> {
    const res = await send<TagDeltasResult>({
      type: "GET_TAG_LEVEL_DELTAS",
      handle,
      problemId,
      level,
      tags,
    });
    return res ?? { ok: false, code: "NETWORK_ERROR", message: "no response" };
  }

  function errorText(code: string): string {
    switch (code) {
      case "RATE_LIMITED":
        return "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.";
      case "USER_NOT_FOUND":
        return "유저 정보를 찾을 수 없어요.";
      case "NETWORK_ERROR":
        return "서버에 연결하지 못했어요.";
      default:
        return "불러오지 못했어요. 다시 호버하면 재시도해요.";
    }
  }


  /* ---------------- 예측 / 배지 ---------------- */

  interface Prediction {
    delta: number;
    color: string;
    change: { before: string; after: string } | null;
  }
  function predict(
    level: number | null,
    deltas: number[],
    currentRating: number
  ): Prediction | null {
    if (level === null) return null;
    const color = colorForLevel(level);
    const delta = deltas[level];
    if (color === null || delta === undefined) return null;

    const before = tierLabel(currentRating);
    const after = tierLabel(currentRating + delta);
    return { delta, color, change: after !== before ? { before, after } : null };
  }

  type BadgeLayout = "list" | "title";

  function makeBadge(p: Prediction, layout: BadgeLayout): HTMLSpanElement {
    const el = document.createElement("span");
    el.className = BADGE_CLASS;
    // position:relative — 호버 박스를 배지 기준으로 띄우기 위함
    const layoutStyle =
      layout === "list"
        ? "float:right;margin-left:12px;position:relative;"
        : "margin-left:0.6em;font-size:0.5em;vertical-align:middle;display:inline-block;position:relative;";
    el.style.cssText = `${layoutStyle}font-weight:bold;white-space:nowrap;color:${p.color};`;

    const tierSpan = (label: string): HTMLSpanElement => {
      const s = document.createElement("span");
      s.textContent = label;
      const c = colorForLabel(label);
      if (c !== null) s.style.color = c;
      return s;
    };

    el.append(`+${p.delta}`);
    if (p.change) {
      el.append(" (", tierSpan(p.change.before), " -> ", tierSpan(p.change.after), ")");
      el.title = `이 문제를 풀면 예상 레이팅 +${p.delta}, 티어 ${p.change.before} -> ${p.change.after}`;
    } else {
      el.title = `이 문제를 풀면 예상 레이팅 +${p.delta}`;
    }
    return el;
  }


  /* ---------------- 호버 박스 ---------------- */
  // <style>을 주입하지 않고(페이지 CSS/CSP와 충돌 방지) 인라인 스타일 + Web Animations만 사용

  function css(el: HTMLElement, style: Partial<CSSStyleDeclaration>): void {
    Object.assign(el.style, style);
  }

  const fmtSigned = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);

  interface BoxParts {
    box: HTMLDivElement; // 배지에 붙는 바깥 래퍼 (투명 여백 포함 → 배지에서 박스로 마우스 이동 시 안 닫힘)
    panel: HTMLDivElement; // 실제로 보이는 카드
  }

  function makeBox(align: "left" | "right"): BoxParts {
    const box = document.createElement("div");
    box.className = "boj-tag-delta-box";
    css(box, {
      display: "none",
      position: "absolute",
      top: "100%",
      paddingTop: "6px",
      zIndex: "9999",
      minWidth: "280px",
      maxWidth: "380px",
      boxSizing: "border-box",
      fontSize: "13px",
      lineHeight: "1.4",
      fontWeight: "normal",
      letterSpacing: "normal",
      textAlign: "left",
      whiteSpace: "normal",
      cursor: "default",
      transformOrigin: `top ${align}`,
    });
    box.style[align] = "0";

    const panel = document.createElement("div");
    css(panel, {
      boxSizing: "border-box",
      padding: "10px 12px",
      background: "#fff",
      color: "#2d3748",
      border: "1px solid #d9dee5",
      borderRadius: "8px",
      boxShadow: "0 6px 20px rgba(0,0,0,0.14)",
    });
    box.append(panel);
    return { box, panel };
  }

  function renderLoading(panel: HTMLElement): void {
    const row = document.createElement("div");
    css(row, { display: "flex", alignItems: "center", gap: "8px", color: "#718096" });

    const spinner = document.createElement("span");
    css(spinner, {
      display: "inline-block",
      flex: "none",
      width: "14px",
      height: "14px",
      boxSizing: "border-box",
      border: "2px solid #d9dee5",
      borderTopColor: "#5381a0",
      borderRadius: "50%",
    });
    spinner.animate(
      [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }],
      { duration: 800, iterations: Infinity }
    );

    row.append(spinner, "태그별 예상 변화를 불러오는 중…");
    panel.replaceChildren(row);
  }

  function renderMessage(panel: HTMLElement, text: string): void {
    const el = document.createElement("div");
    el.textContent = text;
    css(el, { color: "#718096" });
    panel.replaceChildren(el);
  }

  function makeIcon(key: string): HTMLSpanElement {
    const slot = document.createElement("span");
    css(slot, {
      display: "inline-flex",
      flex: "none",
      alignItems: "center",
      justifyContent: "center",
      width: `${ICON_SLOT_PX}px`,
      height: `${ICON_SLOT_PX}px`,
      borderRadius: "6px",
      background: "transparent",
      color: "#4a5568",
    });

    const SVG_NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", ICON_VIEWBOX);
    svg.setAttribute("width", String(ICON_SVG_PX));
    svg.setAttribute("height", String(ICON_SVG_PX));
    svg.setAttribute("aria-hidden", "true");

    const def = TAG_ICON_PATHS[key] ?? "";
    const isObj = typeof def === "object" && !Array.isArray(def);
    const raw = isObj ? def.d : def;
    const mode: IconMode = (isObj ? def.mode : undefined) ?? ICON_DEFAULT_MODE;

    if (mode === "stroke") {
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", String(ICON_STROKE_WIDTH));
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
    } else {
      svg.setAttribute("fill", "currentColor");
      svg.setAttribute("stroke", "none");
    }

    for (const d of Array.isArray(raw) ? raw : [raw]) {
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", d);
      svg.append(path);
    }
    slot.append(svg);
    return slot;
  }

  function makeRow(t: TagDeltaItem): HTMLLIElement {
    const li = document.createElement("li");
    css(li, { display: "flex", alignItems: "center", gap: "10px", margin: "0", padding: "0" });

    const body = document.createElement("div");
    css(body, { flex: "1 1 auto", minWidth: "0" });

    const name = document.createElement("div");
    name.textContent = TAG_NAME_BY_KEY.get(t.key) ?? t.key;
    css(name, { fontWeight: "600" });

    const detail = document.createElement("div");
    detail.textContent =
      `${t.currentRating} → ${t.predictedRating}` +
      ` · 문제합 ${fmtSigned(t.delta.problemSum)}` +
      ` · 보너스 ${fmtSigned(t.delta.solvedBonus)}`;
    css(detail, { fontSize: "12px", color: "#718096" });

    body.append(name, detail);

    const delta = document.createElement("span");
    delta.textContent = fmtSigned(t.delta.rating);
    css(delta, {
      flex: "none",
      fontWeight: "bold",
      color: t.delta.rating > 0 ? "#2b8a3e" : "#718096",
    });

    li.append(makeIcon(t.key), body, delta);
    return li;
  }

  function renderData(panel: HTMLElement, data: TagLevelDeltasData): void {
    const head = document.createElement("div");
    head.textContent = `태그별 예상 레이팅 변화 (난이도 ${data.level})`;
    css(head, { fontSize: "12px", fontWeight: "bold", color: "#718096", marginBottom: "8px" });

    if (data.tagDeltas.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "표시할 태그 정보가 없어요.";
      css(empty, { color: "#718096" });
      panel.replaceChildren(head, empty);
      return;
    }

    const list = document.createElement("ul");
    css(list, {
      display: "flex",
      flexDirection: "column",
      gap: "8px",
      margin: "0",
      padding: "0",
      listStyle: "none",
    });
    for (const t of data.tagDeltas) list.append(makeRow(t));
    panel.replaceChildren(head, list);
  }

  interface TagBoxSource {
    initial: TagLevelDeltasData | null; // 이미 캐시에 있는 값
    load: (() => Promise<TagDeltasResult>) | null; // 없으면 호버 시 요청
    emptyMessage: string; // initial도 load도 없을 때 보여줄 문구
  }

  function attachTagBox(badge: HTMLElement, align: "left" | "right", source: TagBoxSource): void {
    const { box, panel } = makeBox(align);
    badge.append(box);
    badge.removeAttribute("title"); // 네이티브 툴팁이 박스 위에 겹치지 않게
    badge.style.cursor = "help";

    let data = source.initial;
    let loading = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const open = (): void => {
      box.style.display = "block";
      box.animate(
        [
          { opacity: 0, transform: "translateY(-4px) scale(0.97)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: 140, easing: "ease-out" }
      );

      if (data) {
        renderData(panel, data);
        return;
      }
      if (!source.load) {
        renderMessage(panel, source.emptyMessage);
        return;
      }
      if (loading) return; // 이미 로딩 표시 중

      loading = true;
      renderLoading(panel);
      void source.load().then((res) => {
        loading = false;
        if (res.ok) {
          data = res.data;
          renderData(panel, data);
        } else {
          console.debug("[BOJ Rating Preview]", res.code);
          renderMessage(panel, errorText(res.code));
        }
      });
    };

    badge.addEventListener("mouseenter", () => {
      clearTimeout(timer);
      timer = setTimeout(open, HOVER_DELAY_MS);
    });
    badge.addEventListener("mouseleave", () => {
      clearTimeout(timer);
      box.style.display = "none";
    });
  }


  /* ---------------- 페이지 적용 ---------------- */

  function applyToTable(
    table: HTMLTableElement,
    deltas: number[],
    rating: number,
    cached: CachedTagMap
  ): void {
    for (const row of Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody tr"))) {
      const cell = row.cells[TITLE_CELL_INDEX];
      if (!cell || cell.querySelector(`.${BADGE_CLASS}`)) continue;
      if (row.querySelector(SOLVED_LABEL_SELECTOR)) continue; 

      const level = levelFromImg(cell.querySelector<HTMLImageElement>(TIER_IMG_SELECTOR));
      const p = predict(level, deltas, rating);
      if (!p) continue;

      const badge = makeBadge(p, "list");
      cell.prepend(badge); 

      // 목록에는 태그 정보가 없으므로, 문제 페이지에서 이미 캐시된 (난이도가 같은) 것만 표시하고, 없으면 안내 문구만 띄움
      const id = problemIdFromRow(row);
      const entry = id !== null ? cached[String(id)] : undefined;
      const hit = entry && entry.level === level ? entry.data : null;
      attachTagBox(badge, "right", {
        initial: hit,
        load: null,
        emptyMessage:
          "이 문제의 태그 정보가 아직 없어요. 문제 페이지에서 배지에 호버하면 여기에도 표시돼요.",
      });
    }
  }

  function applyToProblemPage(
    titleEl: HTMLElement,
    deltas: number[],
    rating: number,
    handle: string
  ): void {
    const heading = titleEl.parentElement;
    if (!heading || heading.querySelector(`.${BADGE_CLASS}`)) return;
    if (heading.querySelector(SOLVED_LABEL_SELECTOR)) return; 

    const level = levelFromImg(
      document.querySelector<HTMLImageElement>(PROBLEM_MENU_IMG_SELECTOR)
    );
    const p = predict(level, deltas, rating);
    if (!p) return;

    const badge = makeBadge(p, "title");
    titleEl.after(badge);

    // 정보를 못 읽어도 박스는 붙여서, 이유를 화면에 보여줌 (조용히 실패하지 않게)
    const problemId = problemIdFromPage();
    const tags = readTagKeys();
    let load: TagBoxSource["load"] = null;
    let emptyMessage = "태그별 변화량을 계산할 수 있는 태그가 없어요.";
    if (level === null || problemId === null) {
      console.debug("[BOJ Rating Preview]", "problem info not found", { level, problemId });
      emptyMessage = "문제 정보를 읽지 못했어요.";
    } else if (tags.length > 0) {
      load = () => requestTagDeltas(handle, problemId, level, tags);
    }
    attachTagBox(badge, "left", { initial: null, load, emptyMessage });
  }

  async function main(): Promise<void> {
    const table = document.querySelector<HTMLTableElement>(TABLE_SELECTOR);
    const titleEl = document.querySelector<HTMLElement>(PROBLEM_TITLE_SELECTOR);
    if (!table && !titleEl) return; 

    const handle = getHandle();
    if (!handle) return;

    const [res, cachedRes] = await Promise.all([
      send<DeltasResult>({ type: "GET_LEVEL_DELTAS", handle }),
      table
        ? send<CachedTagResult>({ type: "GET_CACHED_TAG_DELTAS", handle })
        : Promise.resolve(undefined),
    ]);
    if (!res || !res.ok) {
      console.debug("[BOJ Rating Preview]", res && !res.ok ? res.code : "no response");
      return;
    }
    const deltas = res.data.deltaByLevel;
    const rating = TEST_RATING_OVERRIDE ?? res.data.current.rating;
    const cached: CachedTagMap = cachedRes && cachedRes.ok ? cachedRes.data : {};

    if (table) applyToTable(table, deltas, rating, cached);
    if (titleEl) applyToProblemPage(titleEl, deltas, rating, handle);
  }

  void main();
})();