import { HANDLE_RE } from "./api.js";
import { HANDLE_OVERRIDE_KEY } from "./types.js";

const input = document.getElementById("handle") as HTMLInputElement;
const status = document.getElementById("status") as HTMLDivElement;

function setStatus(text: string, kind: "" | "ok" | "error" = ""): void {
  status.textContent = text;
  status.className = kind;
}

async function reloadActiveTab(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id !== undefined) await chrome.tabs.reload(tab.id);
  } catch {
    // 새로고침에 실패해도 저장은 된 상태 → 직접 새로고침하면 됨
  }
}

async function save(): Promise<void> {
  const value = input.value.trim();

  if (value === "") {
    await chrome.storage.local.remove(HANDLE_OVERRIDE_KEY);
    setStatus("보정을 해제했어요. 사이트에서 읽은 아이디를 써요.", "ok");
    void reloadActiveTab();
    return;
  }
  if (!HANDLE_RE.test(value)) {
    setStatus("영문, 숫자, _ 만 쓸 수 있어요 (30자 이하).", "error");
    return;
  }

  await chrome.storage.local.set({ [HANDLE_OVERRIDE_KEY]: value });
  setStatus(`이제 모든 요청이 ${value}(으)로 가요.`, "ok");
  void reloadActiveTab();
}

async function init(): Promise<void> {
  try {
    const stored = (await chrome.storage.local.get(HANDLE_OVERRIDE_KEY))[HANDLE_OVERRIDE_KEY];
    if (typeof stored === "string" && HANDLE_RE.test(stored)) input.value = stored;
  } catch {
    // 못 읽으면 빈 칸으로 시작
  }
  input.focus();
}

input.addEventListener("change", () => void save());

void init();