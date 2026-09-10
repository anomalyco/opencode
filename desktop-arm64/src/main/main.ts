import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Agent, DEFAULT_SYSTEM_PROMPT } from "../core/agent.ts";
import { ToolRegistry } from "../core/tools.ts";
import { createProvider } from "../core/providers.ts";
import { loadConfig, saveGlobalConfig, type AppConfig } from "../core/config.ts";
import { SessionStore } from "../core/session.ts";
import type { ApprovalRequest, AgentEvent } from "../core/types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isSmoke = process.argv.includes("--smoke");
const workspaceArg = extractWorkspaceArg();

function extractWorkspaceArg(): string | undefined {
  const args = process.argv.slice(app.isPackaged ? 1 : 2);
  const idx = args.findIndex((a) => a === "--workspace");
  if (idx !== -1 && args[idx + 1]) return path.resolve(args[idx + 1]!);
  const candidate = args.find(
    (a) => !a.startsWith("-") && a !== "--smoke" && a !== process.argv[0],
  );
  return undefined;
}

/* ------------------------------------------------------------------ */
/* logging                                                             */
/* ------------------------------------------------------------------ */

async function log(line: string): Promise<void> {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  console.log(stamped);
  try {
    const file = path.join(app.getPath("userData"), "logs", "main.log");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, `${stamped}\n`, "utf8");
  } catch {
    /* logging must never crash the app */
  }
}

process.on("uncaughtException", (err) => {
  log(`uncaughtException: ${err.stack ?? err.message}`);
});
process.on("unhandledRejection", (reason) => {
  log(`unhandledRejection: ${String(reason)}`);
});

/* ------------------------------------------------------------------ */
/* state                                                               */
/* ------------------------------------------------------------------ */

let mainWindow: BrowserWindow | null = null;
let workspaceRoot = "";
let currentController: AbortController | null = null;
let currentSessionId: string | null = null;
let currentStore: SessionStore | null = null;
const pendingApprovals = new Map<string, (allowed: boolean) => void>();

function stateFile(): string {
  return path.join(app.getPath("userData"), "state.json");
}

function sessionsDir(): string {
  return path.join(app.getPath("userData"), "sessions");
}

function defaultWorkspace(): string {
  return path.join(app.getPath("home"), "Documents");
}

async function readState(): Promise<void> {
  if (workspaceArg) {
    workspaceRoot = workspaceArg;
    return;
  }
  try {
    const parsed = JSON.parse(await fs.readFile(stateFile(), "utf8")) as {
      workspaceRoot?: string;
    };
    if (
      typeof parsed.workspaceRoot === "string" &&
      parsed.workspaceRoot.length > 0
    ) {
      workspaceRoot = parsed.workspaceRoot;
      return;
    }
  } catch {
    /* first run */
  }
  workspaceRoot = defaultWorkspace();
}

async function persistState(): Promise<void> {
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  await fs.writeFile(stateFile(), JSON.stringify({ workspaceRoot }, null, 2), "utf8");
}

function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

async function currentConfig(): Promise<AppConfig> {
  return loadConfig({ projectRoot: workspaceRoot });
}

function configView(config: AppConfig) {
  return {
    protocol: config.protocol,
    baseUrl: config.baseUrl,
    apiKeyMasked: maskKey(config.apiKey),
    hasApiKey: config.apiKey.length > 0,
    model: config.model,
    yolo: config.yolo,
    maxTurns: config.maxTurns,
  };
}

/* ------------------------------------------------------------------ */
/* renderer messaging                                                  */
/* ------------------------------------------------------------------ */

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function forward(ev: AgentEvent): void {
  send("agent:event", ev);
}

/* ------------------------------------------------------------------ */
/* approvals                                                           */
/* ------------------------------------------------------------------ */

function resolveAllApprovals(allowed: boolean): void {
  for (const [id, resolve] of pendingApprovals) {
    resolve(allowed);
    pendingApprovals.delete(id);
  }
}

function makeApprovalHandler() {
  return async (request: ApprovalRequest): Promise<boolean> => {
    const id = randomUUID();
    send("approval:request", { id, kind: request.kind, title: request.title, detail: request.detail });
    return new Promise<boolean>((resolve) => {
      pendingApprovals.set(id, (allowed) => resolve(allowed));
    });
  };
}

/* ------------------------------------------------------------------ */
/* agent runs                                                          */
/* ------------------------------------------------------------------ */

export interface RunResult {
  ok: boolean;
  stopReason?: string;
  error?: string;
}

async function getStore(): Promise<SessionStore> {
  if (!currentStore) currentStore = new SessionStore(sessionsDir());
  return currentStore;
}

function resetSession(): void {
  currentSessionId = null;
}

async function runAgent(text: string): Promise<RunResult> {
  if (currentController) {
    return { ok: false, error: "A task is already running." };
  }
  const controller = new AbortController();
  currentController = controller;

  try {
    let config: AppConfig;
    try {
      config = await currentConfig();
    } catch (err) {
      return { ok: false, error: `config error: ${msg(err)}` };
    }

    const provider = createProvider(config.protocol, {
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
    });
    const tools = new ToolRegistry({ root: workspaceRoot, yolo: config.yolo });

    const store = await getStore();
    if (!currentSessionId) {
      currentSessionId = await store.start(text.trim().slice(0, 120));
    }
    await store.append({
      ts: Date.now(),
      kind: "user",
      payload: { text },
    });

    const agent = new Agent({
      provider,
      tools,
      system: DEFAULT_SYSTEM_PROMPT,
      maxTurns: config.maxTurns,
      signal: controller.signal,
      approval: makeApprovalHandler(),
    });

    let result: RunResult = { ok: true, stopReason: "end_turn" };
    for await (const ev of agent.run(text)) {
      forward(ev);
      switch (ev.kind) {
        case "assistant_message":
          await store.append({
            ts: Date.now(),
            kind: "assistant",
            payload: ev.message,
          });
          break;
        case "tool_end":
          await store.append({
            ts: Date.now(),
            kind: "tool",
            payload: {
              callId: ev.callId,
              name: ev.name,
              output: ev.output,
              isError: ev.isError,
            },
          });
          break;
        case "done":
          result = { ok: true, stopReason: ev.stopReason, error: ev.error };
          await store.append({
            ts: Date.now(),
            kind: "event",
            payload: { stopReason: ev.stopReason, error: ev.error ?? null },
          });
          break;
      }
    }
    return result;
  } catch (err) {
    log(`agent crash: ${err instanceof Error ? err.stack : String(err)}`);
    return { ok: false, error: msg(err) };
  } finally {
    currentController = null;
    resolveAllApprovals(false);
  }
}

/* ------------------------------------------------------------------ */
/* IPC                                                                 */
/* ------------------------------------------------------------------ */

function registerIpc(): void {
  ipcMain.handle("state:init", async () => {
    const config = await currentConfig();
    const store = await getStore();
    return {
      appVersion: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      workspaceRoot,
      config: configView(config),
      sessions: await store.list(),
    };
  });

  ipcMain.handle("config:set", async (_e, patch: Record<string, unknown>) => {
    const clean: Partial<AppConfig> = {};
    if (patch["protocol"] === "openai" || patch["protocol"] === "anthropic") {
      clean.protocol = patch["protocol"];
    }
    if (typeof patch["baseUrl"] === "string" && patch["baseUrl"].trim().length > 0) {
      clean.baseUrl = patch["baseUrl"].trim();
    }
    if (typeof patch["apiKey"] === "string" && patch["apiKey"].length > 0) {
      clean.apiKey = patch["apiKey"];
    }
    if (typeof patch["model"] === "string" && patch["model"].trim().length > 0) {
      clean.model = patch["model"].trim();
    }
    if (typeof patch["yolo"] === "boolean") clean.yolo = patch["yolo"];
    if (typeof patch["maxTurns"] === "number") clean.maxTurns = patch["maxTurns"];
    await saveGlobalConfig(clean);
    return configView(await currentConfig());
  });

  ipcMain.handle("workspace:choose", async () => {
    if (!mainWindow) return workspaceRoot;
    const picked = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
      defaultPath: workspaceRoot,
      title: "Choose workspace folder",
    });
    if (picked.canceled || picked.filePaths.length === 0) return workspaceRoot;
    workspaceRoot = picked.filePaths[0]!;
    resetSession();
    await persistState();
    send("workspace:changed", { workspaceRoot });
    return workspaceRoot;
  });

  ipcMain.handle("session:new", () => {
    resetSession();
  });

  ipcMain.handle("sessions:list", async () => {
    const store = await getStore();
    return store.list();
  });

  ipcMain.handle("chat:send", (_e, text: unknown) => {
    const prompt = typeof text === "string" ? text : "";
    return runAgent(prompt);
  });

  ipcMain.handle("chat:stop", () => {
    currentController?.abort();
    resolveAllApprovals(false);
  });

  ipcMain.handle("approval:respond", (_e, id: unknown, allowed: unknown) => {
    if (typeof id === "string") {
      const resolver = pendingApprovals.get(id);
      pendingApprovals.delete(id);
      resolver?.(allowed === true);
    }
  });

  ipcMain.handle("shell:openExternal", (_e, url: unknown) => {
    if (typeof url === "string" && /^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
  });
}

/* ------------------------------------------------------------------ */
/* window                                                              */
/* ------------------------------------------------------------------ */

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 860,
    minHeight: 560,
    backgroundColor: "#101216",
    autoHideMenuBar: true,
    show: false,
    title: "OpenCode ARM",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);

  mainWindow.once("ready-to-show", () => mainWindow?.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());

  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    log(`renderer gone: ${details.reason} (exitCode ${details.exitCode})`);
    // Recover instead of dying silently.
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.reload();
      } else {
        createWindow();
      }
    }, 500);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  void mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));

  if (isSmoke) {
    mainWindow.webContents.once("did-finish-load", () => {
      log("smoke: renderer loaded successfully");
      console.log(`SMOKE_OK arch=${process.arch} electron=${process.versions.electron}`);
      setTimeout(() => app.exit(0), 300);
    });
  }
}

/* ------------------------------------------------------------------ */
/* lifecycle                                                           */
/* ------------------------------------------------------------------ */

const gotLock = isSmoke ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(async () => {
    log(`starting OpenCode ARM v${app.getVersion()} (${process.platform}/${process.arch}, electron ${process.versions.electron})`);
    await readState();
    registerIpc();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", () => {
  currentController?.abort();
  resolveAllApprovals(false);
});

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
