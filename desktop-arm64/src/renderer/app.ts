interface ConfigView {
  protocol: "openai" | "anthropic";
  baseUrl: string;
  apiKeyMasked: string;
  hasApiKey: boolean;
  model: string;
  yolo: boolean;
  maxTurns: number;
}

interface InitState {
  appVersion: string;
  platform: string;
  arch: string;
  workspaceRoot: string;
  config: ConfigView;
  sessions: Array<{ id: string; title: string }>;
}

interface ApprovalPrompt {
  id: string;
  kind: "run_command" | "write_file" | "edit_file";
  title: string;
  detail: string;
}

interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

type AgentEvent =
  | { kind: "turn_start"; turn: number }
  | { kind: "text_delta"; text: string }
  | {
      kind: "assistant_message";
      message: { role: "assistant"; text: string; toolCalls: ToolCall[] };
    }
  | { kind: "tool_start"; call: ToolCall }
  | {
      kind: "tool_end";
      callId: string;
      name: string;
      output: string;
      isError: boolean;
      durationMs: number;
    }
  | { kind: "usage"; inputTokens?: number; outputTokens?: number }
  | { kind: "done"; stopReason: string; error?: string };

interface OpenCodeApi {
  getState(): Promise<InitState>;
  setConfig(patch: Partial<Record<string, unknown>>): Promise<ConfigView>;
  chooseWorkspace(): Promise<string>;
  newSession(): Promise<void>;
  listSessions(): Promise<Array<{ id: string; title: string }>>;
  send(text: string): Promise<{ ok: boolean; stopReason?: string; error?: string }>;
  stop(): Promise<void>;
  approve(id: string, allowed: boolean): Promise<void>;
  onAgentEvent(cb: (event: AgentEvent) => void): () => void;
  onApprovalRequest(cb: (prompt: ApprovalPrompt) => void): () => void;
  onWorkspaceChanged(cb: (info: { workspaceRoot: string }) => void): () => void;
}

declare global {
  interface Window {
    opencode: OpenCodeApi;
  }
}

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const messagesEl = $<HTMLDivElement>("messages");
const welcomeEl = $("welcome");
const inputEl = $<HTMLTextAreaElement>("input");
const sendBtn = $<HTMLButtonElement>("send-btn");
const stopBtn = $<HTMLButtonElement>("stop-btn");
const statusLeft = $("status-left");
const statusbar = $("statusbar");
const transcript = $("transcript");

let running = false;
let currentAssistantEl: HTMLDivElement | null = null;
let currentBuffer = "";
let renderQueued = false;

/* ------------------------------------------------------------------ */
/* rendering helpers                                                   */
/* ------------------------------------------------------------------ */

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function inline(s: string): string {
  return s
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, "$1<i>$2</i>");
}

function renderMarkdown(text: string): string {
  const parts = text.split(/```/);
  let html = "";
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (i % 2 === 1) {
      const nl = part.indexOf("\n");
      const body = nl === -1 ? "" : part.slice(nl + 1);
      html += `<pre><code>${escapeHtml(body.replace(/\n$/, ""))}</code></pre>`;
    } else {
      const paragraphs = escapeHtml(part).split(/\n{2,}/);
      html += paragraphs
        .filter((p) => p.trim().length > 0)
        .map((p) => `<p>${inline(p).replace(/\n/g, "<br>")}</p>`)
        .join("");
    }
  }
  return html;
}

function nearBottom(): boolean {
  return (
    transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight <
    120
  );
}

function scrollDown(force = false): void {
  if (force || nearBottom()) {
    transcript.scrollTop = transcript.scrollHeight;
  }
}

function addMessage(kind: "user" | "assistant" | "error", html?: string): HTMLDivElement {
  welcomeEl.classList.add("hidden");
  const el = document.createElement("div");
  el.className = `msg ${kind}`;
  if (html !== undefined) el.innerHTML = html;
  messagesEl.appendChild(el);
  scrollDown(true);
  return el;
}

function argsPreview(argsJson: string): string {
  try {
    const parsed = JSON.parse(argsJson || "{}") as Record<string, unknown>;
    const first =
      typeof parsed["path"] === "string"
        ? String(parsed["path"])
        : typeof parsed["command"] === "string"
          ? String(parsed["command"])
          : typeof parsed["pattern"] === "string"
            ? String(parsed["pattern"])
            : Object.values(parsed)[0];
    const text = first === undefined ? "" : String(first);
    return escapeHtml(text.slice(0, 80));
  } catch {
    return escapeHtml(argsJson.slice(0, 80));
  }
}

function addToolCard(callId: string, name: string, argsJson: string): HTMLElement {
  welcomeEl.classList.add("hidden");
  const details = document.createElement("details");
  details.className = "tool-card running";
  details.dataset.callId = callId;
  details.innerHTML = `
    <summary>
      <span class="tool-status"></span>
      <span class="tool-name"></span>
      <span class="tool-args"></span>
    </summary>
    <pre class="tool-output">running…</pre>`;
  details.querySelector(".tool-name")!.textContent = name;
  details.querySelector(".tool-args")!.textContent = argsPreview(argsJson);
  messagesEl.appendChild(details);
  scrollDown();
  return details;
}

/* ------------------------------------------------------------------ */
/* streaming                                                           */
/* ------------------------------------------------------------------ */

function beginAssistantStream(): void {
  if (!currentAssistantEl) {
    currentAssistantEl = addMessage("assistant", "");
    currentBuffer = "";
  }
}

function queueRender(): void {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    if (currentAssistantEl) {
      currentAssistantEl.innerHTML = renderMarkdown(currentBuffer);
      scrollDown();
    }
  });
}

function finishAssistant(finalText: string | null): void {
  const el = currentAssistantEl;
  currentAssistantEl = null;
  if (!el) return;
  const text = finalText ?? currentBuffer;
  if (text.trim().length === 0) {
    el.remove();
    return;
  }
  el.innerHTML = renderMarkdown(text);
  currentBuffer = "";
}

/* ------------------------------------------------------------------ */
/* agent events                                                        */
/* ------------------------------------------------------------------ */

window.opencode.onAgentEvent((ev) => {
  switch (ev.kind) {
    case "turn_start":
      setStatus(`thinking… (turn ${ev.turn})`);
      break;
    case "text_delta":
      beginAssistantStream();
      currentBuffer += ev.text;
      queueRender();
      break;
    case "assistant_message":
      finishAssistant(ev.message.text);
      break;
    case "tool_start":
      finishAssistant(currentBuffer || null);
      addToolCard(ev.call.id, ev.call.name, ev.call.arguments);
      setStatus(`running ${ev.call.name}…`);
      break;
    case "tool_end": {
      const card = messagesEl.querySelector(
        `[data-call-id="${CSS.escape(ev.callId)}"]`,
      );
      if (card instanceof HTMLElement) {
        card.classList.remove("running");
        card.classList.add(ev.isError ? "error" : "ok");
        const out = card.querySelector(".tool-output");
        if (out) out.textContent = ev.output || "(no output)";
        if (ev.isError) card.setAttribute("open", "");
        else card.removeAttribute("open");
        const summary = card.querySelector("summary");
        if (summary) {
          const meta = document.createElement("span");
          meta.className = "muted small";
          meta.style.marginLeft = "auto";
          meta.textContent = `${ev.durationMs} ms`;
          summary.appendChild(meta);
        }
      }
      break;
    }
    case "usage":
      break;
    case "done":
      finishAssistant(currentBuffer || null);
      handleDone(ev.stopReason, ev.error);
      break;
  }
});

function handleDone(stopReason: string, error?: string): void {
  if (stopReason === "provider_error") {
    addMessage(
      "error",
      `<b>Provider error.</b> ${escapeHtml(error ?? "unknown error")}`,
    );
  } else if (stopReason === "max_turns") {
    addMessage("error", "Stopped after the maximum number of tool turns.");
  } else if (stopReason === "aborted") {
    addMessage("assistant", "<i>stopped by user</i>");
  }
  setRunning(false);
  setStatus(
    stopReason === "end_turn"
      ? "Ready."
      : `Finished (${stopReason}).`,
  );
}

function setStatus(text: string): void {
  statusLeft.textContent = text;
}

function setRunning(value: boolean): void {
  running = value;
  sendBtn.disabled = value;
  stopBtn.classList.toggle("hidden", !value);
  statusbar.classList.toggle("busy", value);
  inputEl.focus();
}

/* ------------------------------------------------------------------ */
/* composer                                                            */
/* ------------------------------------------------------------------ */

async function submit(): Promise<void> {
  const text = inputEl.value.trim();
  if (text.length === 0 || running) return;
  inputEl.value = "";
  autoResize();
  addMessage("user", undefined)?.replaceChildren(document.createTextNode(text));
  setRunning(true);
  setStatus("connecting…");
  try {
    await window.opencode.send(text);
  } catch (err) {
    handleDone("provider_error", err instanceof Error ? err.message : String(err));
  }
}

$("#composer").addEventListener("submit", (e) => {
  e.preventDefault();
  void submit();
});

stopBtn.addEventListener("click", () => {
  void window.opencode.stop();
});

function autoResize(): void {
  inputEl.style.height = "auto";
  inputEl.style.height = `${Math.min(inputEl.scrollHeight, 180)}px`;
}

inputEl.addEventListener("input", autoResize);

/* ------------------------------------------------------------------ */
/* approvals                                                           */
/* ------------------------------------------------------------------ */

const approvalModal = $<HTMLDialogElement>("approval-modal");
let activeApprovalId: string | null = null;

window.opencode.onApprovalRequest((prompt) => {
  activeApprovalId = prompt.id;
  $("approval-title").textContent = `Allow ${prompt.title}?`;
  const detail = $<HTMLPreElement>("approval-detail");
  detail.textContent = prompt.detail || "(no detail)";
  approvalModal.showModal();
});

$("approval-allow").addEventListener("click", () => {
  if (activeApprovalId) void window.opencode.approve(activeApprovalId, true);
  activeApprovalId = null;
  approvalModal.close();
});

$("approval-deny").addEventListener("click", () => {
  if (activeApprovalId) void window.opencode.approve(activeApprovalId, false);
  activeApprovalId = null;
  approvalModal.close();
});

approvalModal.addEventListener("cancel", (e) => {
  e.preventDefault();
});

/* ------------------------------------------------------------------ */
/* settings                                                            */
/* ------------------------------------------------------------------ */

const settingsModal = $<HTMLDialogElement>("settings-modal");
let savedConfig: ConfigView | null = null;

function fillSettings(config: ConfigView): void {
  $<HTMLSelectElement>("f-protocol").value = config.protocol;
  $<HTMLInputElement>("f-baseurl").value = config.baseUrl;
  $<HTMLInputElement>("f-model").value = config.model;
  $<HTMLInputElement>("f-apikey").value = "";
  $<HTMLInputElement>("f-yolo").checked = config.yolo;
  $<HTMLInputElement>("f-maxturns").value = String(config.maxTurns);
  const hint = $("f-keyhint");
  hint.textContent = config.hasApiKey ? `(saved: ${config.apiKeyMasked})` : "(not set)";
}

$("settings-btn").addEventListener("click", async () => {
  if (savedConfig) fillSettings(savedConfig);
  settingsModal.showModal();
});

$<HTMLSelectElement>("f-protocol").addEventListener("change", () => {
  const protocol = $<HTMLSelectElement>("f-protocol").value;
  const base = $<HTMLInputElement>("f-baseurl");
  const model = $<HTMLInputElement>("f-model");
  if (protocol === "anthropic") {
    if (/openai\.com/.test(base.value)) base.value = "https://api.anthropic.com";
    if (/^gpt-/i.test(model.value)) model.value = "claude-sonnet-4-5";
  } else {
    if (/anthropic\.com/.test(base.value)) base.value = "https://api.openai.com/v1";
    if (/^claude/i.test(model.value)) model.value = "gpt-4o-mini";
  }
});

$("#settings-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const save = document.activeElement === $("#settings-save");
  if (!save) {
    settingsModal.close();
    if (savedConfig) fillSettings(savedConfig);
    return;
  }
  const apiKey = $<HTMLInputElement>("f-apikey").value.trim();
  const patch: Partial<Record<string, unknown>> = {
    protocol: $<HTMLSelectElement>("f-protocol").value,
    baseUrl: $<HTMLInputElement>("f-baseurl").value.trim(),
    model: $<HTMLInputElement>("f-model").value.trim(),
    yolo: $<HTMLInputElement>("f-yolo").checked,
    maxTurns: Number($<HTMLInputElement>("f-maxturns").value) || undefined,
  };
  if (apiKey.length > 0) patch["apiKey"] = apiKey;
  try {
    savedConfig = await window.opencode.setConfig(patch);
    setStatus(`Saved. Model: ${savedConfig.model}`);
    settingsModal.close();
  } catch (err) {
    alert(`Could not save settings:\n${err instanceof Error ? err.message : err}`);
  }
});

/* ------------------------------------------------------------------ */
/* header actions                                                      */
/* ------------------------------------------------------------------ */

function basename(p: string): string {
  const norm = p.replaceAll("\\", "/");
  return norm.split("/").filter(Boolean).pop() ?? p;
}

function setWorkspace(p: string): void {
  $("workspace-label").textContent = p.length > 44 ? `…${p.slice(-43)}` : p;
  $("workspace-chip").title = p;
}

$("workspace-chip").addEventListener("click", async () => {
  const root = await window.opencode.chooseWorkspace();
  setWorkspace(root);
});

$("new-chat-btn").addEventListener("click", async () => {
  await window.opencode.newSession();
  messagesEl.replaceChildren();
  currentAssistantEl = null;
  currentBuffer = "";
  welcomeEl.classList.remove("hidden");
  setStatus("Ready.");
  inputEl.focus();
});

window.opencode.onWorkspaceChanged(({ workspaceRoot }) => {
  setWorkspace(workspaceRoot);
  messagesEl.replaceChildren();
  welcomeEl.classList.remove("hidden");
});

/* ------------------------------------------------------------------ */
/* boot                                                               */
/* ------------------------------------------------------------------ */

async function boot(): Promise<void> {
  try {
    const state = await window.opencode.getState();
    savedConfig = state.config;
    fillSettings(state.config);
    setWorkspace(state.workspaceRoot);
    $("arch-badge").textContent = state.arch.toUpperCase();
    setStatus(`Ready. ${state.platform}/${state.arch} · v${state.appVersion}`);
  } catch (err) {
    setStatus(`Init failed: ${err instanceof Error ? err.message : err}`);
  }
  autoResize();
  inputEl.focus();
}

void boot();
