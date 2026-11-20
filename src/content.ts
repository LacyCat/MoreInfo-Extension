
type DeltasResult =
  | { ok: true; data: { current: { rating: number }; deltaByLevel: number[] } }
  | { ok: false; code: string; message: string };

(() => {

  const TABLE_SELECTOR = "table#problemset";
  const TITLE_CELL_INDEX = 1; 
  const TIER_IMG_SELECTOR = "img.solvedac-tier"; 
  const SOLVED_LABEL_SELECTOR = ".problem-label-ac"; 

  const PROBLEM_TITLE_SELECTOR = "#problem_title";
  const PROBLEM_MENU_IMG_SELECTOR = ".problem-menu img.solvedac-tier";

  const BADGE_CLASS = "boj-rating-delta";

  const TEST_RATING_OVERRIDE = null as number | null;

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
    const layoutStyle =
      layout === "list"
        ? "float:right;margin-left:12px;"
        : "margin-left:0.6em;font-size:0.5em;vertical-align:middle;";
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

  function applyToTable(table: HTMLTableElement, deltas: number[], rating: number): void {
    for (const row of Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody tr"))) {
      const cell = row.cells[TITLE_CELL_INDEX];
      if (!cell || cell.querySelector(`.${BADGE_CLASS}`)) continue;
      if (row.querySelector(SOLVED_LABEL_SELECTOR)) continue; 

      const level = levelFromImg(cell.querySelector<HTMLImageElement>(TIER_IMG_SELECTOR));
      const p = predict(level, deltas, rating);
      if (p) cell.prepend(makeBadge(p, "list")); 
    }
  }

  function applyToProblemPage(titleEl: HTMLElement, deltas: number[], rating: number): void {
    const heading = titleEl.parentElement;
    if (!heading || heading.querySelector(`.${BADGE_CLASS}`)) return;
    if (heading.querySelector(SOLVED_LABEL_SELECTOR)) return; 

    const level = levelFromImg(
      document.querySelector<HTMLImageElement>(PROBLEM_MENU_IMG_SELECTOR)
    );
    const p = predict(level, deltas, rating);
    if (p) titleEl.after(makeBadge(p, "title"));
  }

  async function main(): Promise<void> {
    const table = document.querySelector<HTMLTableElement>(TABLE_SELECTOR);
    const titleEl = document.querySelector<HTMLElement>(PROBLEM_TITLE_SELECTOR);
    if (!table && !titleEl) return; 

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
    const rating = TEST_RATING_OVERRIDE ?? res.data.current.rating;

    if (table) applyToTable(table, deltas, rating);
    if (titleEl) applyToProblemPage(titleEl, deltas, rating);
  }

  void main();
})();