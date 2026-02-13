import {
  CodeLanguage,
  Daytona,
  DaytonaNotFoundError,
  Image,
  type PtyHandle as DaytonaPtyHandle,
} from "@daytonaio/sdk";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  CloudSandbox,
  ExecOptions,
  ExecResult,
  PtyOptions,
  PtyHandle,
} from "../index.ts";
import {
  withSpan,
  SpanKind,
  daytonaApiDuration,
  startTimer,
} from "../../observability/index.ts";

const DEBUG_DAYTONA = process.env.OPENCODE_DEBUG_DAYTONA === "1";
const DAYTONA_TIMEOUT_MS = Number.parseInt(process.env.DAYTONA_TIMEOUT_MS || "10000", 10);
// Read operations (get, snapshot.get) can be slower due to API latency - use a longer timeout
const DAYTONA_READ_TIMEOUT_MS = Number.parseInt(process.env.DAYTONA_READ_TIMEOUT_MS || "30000", 10);

// Timeout wrapper for Daytona operations
function withTimeout<T>(promise: Promise<T>, ms: number, operation: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Daytona operation '${operation}' timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function debugLog(kind: string, payload: Record<string, unknown>) {
  if (!DEBUG_DAYTONA) return;
  const time = new Date().toLocaleTimeString();
  const details = Object.entries(payload)
    .map(([k, v]) => {
      if (v === undefined || v === null) return null;
      if (typeof v === "object") return `${k}=${JSON.stringify(v)}`;
      return `${k}=${v}`;
    })
    .filter(Boolean)
    .join(" ");
  console.log(`${time} DBG [${kind}] ${details}`);
}

function detectRepoOpencodeVersion() {
  try {
    const filename = fileURLToPath(import.meta.url);
    const dirname = path.dirname(filename);
    const pkgPath = path.resolve(dirname, "../../../../packages/opencode/package.json");
    const raw = readFileSync(pkgPath, "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    if (typeof parsed.version === "string" && parsed.version.length > 0) return parsed.version;
  } catch {
    // ignore
  }
  return undefined;
}

function safeSandboxName(raw: string) {
  return raw.toLowerCase().replace(/[^a-z0-9-_.]/g, "-").replace(/-+/g, "-").slice(0, 80);
}

function shellEscape(value: string) {
  return JSON.stringify(value);
}

function decodeIpv4LittleEndian(hex: string) {
  if (!/^[0-9A-Fa-f]{8}$/.test(hex)) return null;
  const bytes = hex.match(/../g);
  if (!bytes) return null;
  return bytes
    .slice()
    .reverse()
    .map((b) => Number.parseInt(b, 16))
    .join(".");
}

export class DaytonaSandbox implements CloudSandbox {
  public readonly id: string;
  public readonly provider = "daytona";
  
  private daytona: Daytona;
  private sandboxName: string;
  private _sandboxInstance: any = null; // Cached Daytona Sandbox type
  private orgId: string;
  private sessionId: string;
  private baseImage: Image;
  private snapshotName?: string;
  private target?: string;
  private opencodeVersion: string;
  private publicPreview: boolean;
  private opencodeSessions = new Map<number, { sessionId: string; cmdId: string }>();
  private networkAllowList?: string;
  private networkBlockAll?: boolean;
  private envVars: Record<string, string>;
  private allowedEnvKeys: Set<string>;
  private shellPath?: string;

  constructor(params: {
    orgId: string;
    sessionId: string;
    apiKey?: string;
    apiUrl?: string;
    target?: string;
  }) {
    const apiUrl = params.apiUrl
      ? params.apiUrl.endsWith("/api")
        ? params.apiUrl
        : `${params.apiUrl.replace(/\/+$/, "")}/api`
      : undefined;

    this.target = params.target ?? process.env.DAYTONA_TARGET;

    const finalKey = params.apiKey?.trim();

    this.daytona = new Daytona({
      apiKey: finalKey,
      apiUrl,
      target: this.target,
    });
    this.orgId = params.orgId;
    this.sessionId = params.sessionId;
    this.sandboxName = safeSandboxName(`claxedo-${params.orgId}-${params.sessionId}`);
    this.id = this.sandboxName; // Use name as ID for now
    this.opencodeVersion = process.env.OPENCODE_VERSION || detectRepoOpencodeVersion() || "latest";
    this.snapshotName = process.env.DAYTONA_SNAPSHOT_NAME;
    this.publicPreview =
      process.env.DAYTONA_PUBLIC_PREVIEW !== undefined
        ? process.env.DAYTONA_PUBLIC_PREVIEW === "true"
        : process.env.NODE_ENV !== "production";
    this.networkAllowList = process.env.DAYTONA_NETWORK_ALLOW_LIST;
    this.networkBlockAll =
      process.env.DAYTONA_NETWORK_BLOCK_ALL !== undefined
        ? process.env.DAYTONA_NETWORK_BLOCK_ALL === "true"
        : undefined;

    const allowedEnvKeys = [
      // OpenCode config
      "OPENCODE_CONFIG",
      "OPENCODE_CONFIG_DIR",
      "OPENCODE_CONFIG_CONTENT",
      "OPENCODE_DISABLE_PROJECT_CONFIG",

      // Vercel AI Gateway
      "AI_GATEWAY_API_KEY",

      // Common LLM provider keys
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "OPENROUTER_API_KEY",
      "GROQ_API_KEY",
      "MISTRAL_API_KEY",
      "TOGETHERAI_API_KEY",
      "PERPLEXITY_API_KEY",
      "XAI_API_KEY",
      "GOOGLE_GENERATIVE_AI_API_KEY",

      // Cloudflare AI Gateway
      "CLOUDFLARE_API_TOKEN",
      "CLOUDFLARE_ACCOUNT_ID",
      "CLOUDFLARE_GATEWAY_ID",
    ];

    this.allowedEnvKeys = new Set(allowedEnvKeys);

    const envVars: Record<string, string> = {};
    for (const key of allowedEnvKeys) {
      const value = process.env[key];
      if (typeof value === "string" && value.length > 0) envVars[key] = value;
    }
    this.envVars = envVars;

    const bunVersion = process.env.BUN_VERSION || "1.1.38";
    this.baseImage = Image.base("node:22.22.0-bookworm-slim")
      .runCommands(
        // Keep this in a single RUN for better layer caching.
        [
          "export DEBIAN_FRONTEND=noninteractive",
          "&& apt-get update",
          "&& apt-get install -y --no-install-recommends",
          // Shells (OpenCode may attempt to spawn /bin/zsh on some setups)
          "bash",
          "zsh",
          // Basics
          "ca-certificates",
          "curl",
          "git",
          "openssh-client",
          // Useful for debugging / networking / ps
          "procps",
          "iproute2",
          "netcat-openbsd",
          // Build tools (native deps)
          "python3",
          "make",
          "g++",
          // Needed for Bun install script
          "unzip",
          "&& rm -rf /var/lib/apt/lists/*",
        ].join(" "),
      )
      .runCommands(
        // Install Bun
        [
          `export BUN_INSTALL=/usr/local/bun`,
          `curl -fsSL https://bun.sh/install | bash -s "bun-v${bunVersion}"`,
          `ln -sf /usr/local/bun/bin/bun /usr/local/bin/bun`,
          `bun --version`,
        ].join(" && "),
      )
      // OpenCode CLI is published as `opencode-ai` on npm.
      .runCommands(`npm i -g opencode-ai@${this.opencodeVersion}`, "opencode --version")
      .env({ SHELL: "/bin/bash" })
      .workdir("/workspace");
  }

  async setEnvVars(extra: Record<string, string>) {
    for (const [key, value] of Object.entries(extra)) {
      if (!this.allowedEnvKeys.has(key)) continue;
      if (typeof value !== "string" || value.length === 0) continue;
      this.envVars[key] = value;
    }
  }

  async ensureRunning(): Promise<void> {
    if (this._sandboxInstance && this._sandboxInstance.state === "started") return;

    // The Daytona SDK requires a target to create sandboxes.
    if (!this.target) {
      throw new Error(
        "Missing DAYTONA_TARGET. Set it in the environment (e.g. `DAYTONA_TARGET=us`) or pass it via SandboxConfig.",
      );
    }

    try {
      console.log(`[Daytona] Getting sandbox ${this.sandboxName}...`);
      const getTimer = startTimer();
      this._sandboxInstance = await withTimeout(
        this.daytona.get(this.sandboxName),
        DAYTONA_READ_TIMEOUT_MS,
        `get(${this.sandboxName})`
      );
      daytonaApiDuration.observe({ operation: "get", status: "success" }, getTimer());
    } catch (err) {
      // Allow sandbox creation if:
      // 1. Sandbox doesn't exist (DaytonaNotFoundError)
      // 2. Get operation timed out (likely doesn't exist or API is slow)
      const isNotFound = err instanceof DaytonaNotFoundError;
      const isTimeout = err instanceof Error && err.message.includes("timed out");
      if (!isNotFound && !isTimeout) throw err;

      if (isTimeout) {
        console.log(`[Daytona] Get timed out, assuming sandbox doesn't exist and creating new one...`);
      }
      console.log(`[Daytona] Creating sandbox ${this.sandboxName}...`);
      debugLog("daytona.sandbox.create", {
        sandboxName: this.sandboxName,
        target: this.target,
        publicPreview: this.publicPreview,
        snapshotName: this.snapshotName,
      });
      if (this.snapshotName) {
        // Pre-built snapshot path (permanently cached). Ensure it exists first.
        const snapshotGetTimer = startTimer();
        try {
          await withTimeout(
            this.daytona.snapshot.get(this.snapshotName),
            DAYTONA_READ_TIMEOUT_MS,
            `snapshot.get(${this.snapshotName})`
          );
          daytonaApiDuration.observe({ operation: "snapshot.get", status: "success" }, snapshotGetTimer());
        } catch {
          daytonaApiDuration.observe({ operation: "snapshot.get", status: "not_found" }, snapshotGetTimer());
          console.log(`[Daytona] Creating snapshot ${this.snapshotName}...`);
          const snapshotCreateTimer = startTimer();
          await withTimeout(
            this.daytona.snapshot.create(
              { name: this.snapshotName, image: this.baseImage },
              { timeout: 0, onLogs: (chunk) => console.log(chunk) },
            ),
            120_000, // 2 minutes for snapshot creation
            `snapshot.create(${this.snapshotName})`
          );
          daytonaApiDuration.observe({ operation: "snapshot.create", status: "success" }, snapshotCreateTimer());
        }
        const createFromSnapshotTimer = startTimer();
        this._sandboxInstance = await withTimeout(
          this.daytona.create(
            {
              name: this.sandboxName,
              language: CodeLanguage.TYPESCRIPT,
              snapshot: this.snapshotName,
              envVars: this.envVars,
              labels: { app: "claxedo", orgId: this.orgId, sessionId: this.sessionId },
              public: this.publicPreview,
              networkAllowList: this.networkAllowList,
              networkBlockAll: this.networkBlockAll,
              autoStopInterval: 60,
            },
            { timeout: 0 },
          ),
          300_000, // 5 minutes for sandbox creation
          `create(${this.sandboxName})`
        );
        daytonaApiDuration.observe({ operation: "create_from_snapshot", status: "success" }, createFromSnapshotTimer());
      } else {
        // Declarative image path (cached ~24h).
        const createFromImageTimer = startTimer();
        this._sandboxInstance = await withTimeout(
          this.daytona.create(
            {
              name: this.sandboxName,
              language: CodeLanguage.TYPESCRIPT,
              image: this.baseImage,
              envVars: this.envVars,
              labels: { app: "claxedo", orgId: this.orgId, sessionId: this.sessionId },
              public: this.publicPreview,
              networkAllowList: this.networkAllowList,
              networkBlockAll: this.networkBlockAll,
              autoStopInterval: 60,
            },
            {
              timeout: 0,
              onSnapshotCreateLogs: (chunk) => console.log(chunk),
            },
          ),
          300_000, // 5 minutes for sandbox creation
          `create(${this.sandboxName})`
        );
        daytonaApiDuration.observe({ operation: "create_from_image", status: "success" }, createFromImageTimer());
      }
    }

    if (this._sandboxInstance.state !== "started") {
      console.log(`[Daytona] Starting sandbox ${this.sandboxName}...`);
      const startTimer2 = startTimer();
      await withTimeout(
        this._sandboxInstance.start(600),
        DAYTONA_TIMEOUT_MS,
        `start(${this.sandboxName})`
      );
      daytonaApiDuration.observe({ operation: "start", status: "success" }, startTimer2());
    }

    debugLog("daytona.sandbox.running", {
      sandboxName: this.sandboxName,
      state: this._sandboxInstance?.state,
    });

    // Some environments may run from an older snapshot missing core tools.
    // Ensure required binaries exist so OpenCode can spawn shells and git works.
    await this.ensureTools();
  }

  private async runWithSh(cmd: string, cwd?: string, env?: Record<string, string>, timeoutSec?: number) {
    const res = await this._sandboxInstance.process.executeCommand(
      `sh -lc ${shellEscape(cmd)}`,
      cwd,
      env,
      timeoutSec,
    );
    return {
      code: res.exitCode ?? 0,
      stdout: res.result ?? "",
      stderr: "",
    } satisfies ExecResult;
  }

  private async ensureTools() {
    const check = await this.runWithSh(
      `command -v bash >/dev/null 2>&1 && command -v git >/dev/null 2>&1 && command -v curl >/dev/null 2>&1 && echo ok || echo missing`,
      "/",
      undefined,
      30,
    );
    if (check.stdout.trim() === "ok") {
      this.shellPath = "/bin/bash";
      return;
    }

    const install = await this.runWithSh(
      [
        "export DEBIAN_FRONTEND=noninteractive",
        "apt-get update",
        "apt-get install -y --no-install-recommends bash git curl ca-certificates",
        "rm -rf /var/lib/apt/lists/*",
        "command -v bash >/dev/null 2>&1",
        "command -v git >/dev/null 2>&1",
        "command -v curl >/dev/null 2>&1",
      ].join(" && "),
      "/",
      undefined,
      600,
    );
    if (install.code !== 0) {
      throw new Error(
        `Sandbox missing required tools (bash/git/curl) and install failed (code=${install.code}). Output:\n${install.stdout}`,
      );
    }
    this.shellPath = "/bin/bash";
  }

  private async shell() {
    if (this.shellPath) return this.shellPath;
    await this.ensureRunning();

    const probe = await this.runWithSh(
      `command -v bash >/dev/null 2>&1 && echo /bin/bash || echo /bin/sh`,
      "/",
      undefined,
      30,
    );
    const value = probe.stdout.trim();
    const shellPath = value === "/bin/bash" ? "/bin/bash" : "/bin/sh";
    this.shellPath = shellPath;
    return shellPath;
  }

  async destroy(): Promise<void> {
    try {
      let sandbox = this._sandboxInstance;
      if (!sandbox) {
        try {
          sandbox = await withTimeout(
            this.daytona.get(this.sandboxName),
            DAYTONA_READ_TIMEOUT_MS,
            `get(${this.sandboxName})`
          );
        } catch (e: any) {
           if (e instanceof DaytonaNotFoundError || e?.code === 404) return;
           throw e;
        }
      }

      if (sandbox) {
        await withTimeout(
          this.daytona.delete(sandbox),
          DAYTONA_TIMEOUT_MS,
          `delete(${this.sandboxName})`
        );
      }
    } catch (err: any) {
      // Ignore if already gone
      if (err instanceof DaytonaNotFoundError) return;
      if (err?.code === 404) return;
      throw err;
    }
  }

  async exec(cmd: string, options?: ExecOptions): Promise<ExecResult> {
    await this.ensureRunning();
    const shellPath = await this.shell();
    const res = await this._sandboxInstance.process.executeCommand(
      `${shellPath} -lc ${shellEscape(cmd)}`,
      options?.cwd,
      options?.env,
      options?.timeoutSec,
    );
    return {
      code: res.exitCode ?? 0,
      stdout: res.result ?? "",
      stderr: "",
    };
  }

  async spawnPty(options: PtyOptions): Promise<PtyHandle> {
    await this.ensureRunning();
    
    const handle: DaytonaPtyHandle = await this._sandboxInstance.process.createPty({
      id: options.id,
      cwd: options.cwd,
      envs: options.env,
      cols: options.cols,
      rows: options.rows,
      onData: options.onData,
    });
    
    await handle.waitForConnection();
    
    return {
      sendInput: (d) => handle.sendInput(d),
      resize: (c, r) => this._sandboxInstance.process.resizePtySession(options.id, c, r),
      kill: () => handle.kill(),
      waitForConnection: () => Promise.resolve(), // Already awaited
    };
  }

  async getServiceUrl(port: number): Promise<string> {
    await this.ensureRunning();
    const candidates: Array<{ url: string; token?: string }> = [];
    try {
      if (typeof (this._sandboxInstance as any).getPreviewLink === "function") {
        const preview = await (this._sandboxInstance as any).getPreviewLink(port);
        if (preview?.url) candidates.push({ url: String(preview.url), token: preview?.token });
      }

      // Prefer a signed preview URL when the sandbox is private, since browsers can't
      // attach `x-daytona-preview-token` headers to WebSocket connections.
      if (typeof (this._sandboxInstance as any).getSignedPreviewUrl === "function") {
        const signed = await (this._sandboxInstance as any).getSignedPreviewUrl(
          port,
          60 * 60, // 1 hour
        );
        if (signed?.url) {
          // Always prefer signed preview URLs for browser compatibility (HTTP + WS).
          candidates.unshift({ url: String(signed.url) });
        }
      }
    } catch {
      // ignore and fallback below
    }

    debugLog("daytona.preview.candidates", {
      sandboxId: this.id,
      port,
      candidates: candidates.map((c) => ({ url: c.url, hasToken: !!c.token })),
    });

    // Validate from the orchestrator host by hitting /global/health. This prevents returning
    // a preview URL that currently responds 502 due to preview-proxy warmup/auth issues.
    for (const candidate of candidates) {
      const baseUrl = candidate.url;
      try {
        const res = await fetch(`${baseUrl}/global/health`, {
          method: "GET",
          signal: AbortSignal.timeout(5000),
          headers: {
            // Avoid the browser warning page (harmless for APIs, but sometimes breaks automation).
            "X-Daytona-Skip-Preview-Warning": "true",
            ...(candidate.token ? { "x-daytona-preview-token": candidate.token } : {}),
          },
        });
        debugLog("daytona.preview.validate", {
          sandboxId: this.id,
          port,
          url: baseUrl,
          status: res.status,
          ok: res.ok,
        });
        if (res.ok) return baseUrl;
      } catch {
        debugLog("daytona.preview.validate_error", { sandboxId: this.id, port, url: baseUrl });
        // try next candidate
      }
    }

    // If validation failed (e.g. preview proxy needs a warm-up), still return the
    // best candidate from the SDK rather than guessing a domain.
    return candidates[0]?.url ?? (() => {
      throw new Error("Unable to determine Daytona preview URL (no candidates from SDK)");
    })();
  }

  async ensureRepo(repoUrl: string, targetDir: string): Promise<void> {
    const probe = await this.exec(`[ -d ${shellEscape(`${targetDir}/.git`)} ] && echo "exists"`);
    if (probe.stdout.trim() === "exists") return;

    console.log(`[Daytona] Cloning ${repoUrl} to ${targetDir}...`);
    const mkdir = await this.exec(`mkdir -p ${shellEscape(targetDir)}`);
    if (mkdir.code !== 0) {
      throw new Error(`Failed to create repo directory ${targetDir}. Output:\n${mkdir.stdout}`);
    }
    // Prefer Daytona's Git helper, but fall back to in-sandbox `git clone` if the
    // toolbox/network path is restricted (common on lower tiers / restricted egress).
    try {
      await this._sandboxInstance.git.clone(repoUrl, targetDir);
      const verified = await this.exec(`[ -d ${shellEscape(`${targetDir}/.git`)} ] && echo "ok" || echo "missing"`);
      if (verified.stdout.trim() === "ok") return;
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.warn(`[Daytona] git.clone failed, falling back to in-sandbox git: ${msg}`);
    }

    // Use in-sandbox git directly (respects sandbox egress policy).
    const cloned = await this.exec(
      [
        `rm -rf ${shellEscape(targetDir)}`,
        `mkdir -p ${shellEscape(targetDir)}`,
        `git clone --depth 1 ${shellEscape(repoUrl)} ${shellEscape(targetDir)}`,
      ].join(" && "),
    );
    if (cloned.code !== 0) {
      throw new Error(`git clone failed (code=${cloned.code}). Output:\n${cloned.stdout}`);
    }

    const verified = await this.exec(`[ -d ${shellEscape(`${targetDir}/.git`)} ] && echo "ok" || echo "missing"`);
    if (verified.stdout.trim() !== "ok") {
      const ls = await this.exec(`ls -la ${shellEscape(targetDir)} || true`);
      throw new Error(`Repo clone did not produce a git repo at ${targetDir}. Listing:\n${ls.stdout}`);
    }
  }

  async ensureOpencodeServer(opts: {
    port: number;
    cwd?: string;
  }): Promise<void> {
    await this.ensureRunning();

    const cwd =
      opts.cwd ??
      (typeof this._sandboxInstance?.getWorkDir === "function"
        ? ((await this._sandboxInstance.getWorkDir()) as string | undefined)
        : undefined) ??
      "/workspace";
    // Ensure cwd exists to avoid `cd` failure in the session command.
    await this.exec(`mkdir -p ${shellEscape(cwd)}`);
    // The UI uses `sdk.global.health()` which hits `/global/health`.
    const url = `http://127.0.0.1:${opts.port}/global/health`;
    const sessionId = `opencode-${opts.port}`;

    const checkCmd = `curl -sf ${shellEscape(url)} >/dev/null`;
    const alreadyUp = await this.exec(checkCmd, { cwd }).catch(() => null);
    if (alreadyUp?.code === 0) return;

    console.log(`[Daytona] Starting opencode server on port ${opts.port}...`);
    debugLog("daytona.opencode.start", {
      sandboxId: this.id,
      port: opts.port,
      cwd,
      envKeys: Object.keys(this.envVars),
    });
    await this._sandboxInstance.process.createSession(sessionId).catch(() => {});

    const envPairs = Object.entries(this.envVars)
      .map(([k, v]) => `${k}=${shellEscape(v)}`)
      .join(" ");

    const serveArgs: string[] = ["serve", "--hostname", "0.0.0.0", "--port", String(opts.port)];
    const serveLogLevel = process.env.OPENCODE_SERVE_LOG_LEVEL;
    const debugServe = process.env.OPENCODE_DEBUG_OPENCODE_SERVE === "1";
    if (debugServe) {
      serveArgs.push("--print-logs");
      // Provide a sane default when debugging.
      serveArgs.push("--log-level", (serveLogLevel || "DEBUG").toUpperCase());
    } else if (serveLogLevel) {
      serveArgs.push("--log-level", serveLogLevel.toUpperCase());
    }
    const extra = process.env.OPENCODE_SERVE_ARGS;
    if (extra && extra.trim().length > 0) {
      // Advanced escape hatch (space-delimited args).
      serveArgs.push(...extra.trim().split(/\s+/g));
    }

    const serveCmdInner = `opencode ${serveArgs.map(shellEscape).join(" ")}`;
    const serveCmd = envPairs.length > 0 ? `env ${envPairs} ${serveCmdInner}` : serveCmdInner;

    const shellPath = await this.shell();
    const command = `${shellPath} -lc ${shellEscape(
      [`cd ${shellEscape(cwd)}`, serveCmd].join(" && "),
    )}`;
    const started = await this._sandboxInstance.process.executeSessionCommand(sessionId, {
      command,
      runAsync: true,
    });
    if (started?.cmdId) {
      this.opencodeSessions.set(opts.port, { sessionId, cmdId: started.cmdId });
    }

    // Wait for server to become healthy.
    let healthy = false;
    for (let i = 0; i < 30; i++) {
      const ok = await this.exec(checkCmd, { cwd }).catch(() => null);
      if (ok?.code === 0) {
        healthy = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    if (healthy) {
      debugLog("daytona.opencode.healthy", { sandboxId: this.id, port: opts.port, cwd });
      // Preview proxies reach the sandbox over its network interface (not loopback).
      // If the server is only bound to 127.0.0.1, Daytona preview URLs will 502.
      const ipRes = await this.exec(
        `node -e ${shellEscape(
          [
            "const os = require('os');",
            "const nets = os.networkInterfaces();",
            "const ips = [];",
            "for (const list of Object.values(nets)) {",
            "  for (const n of (list || [])) {",
            "    if (n && n.family === 'IPv4' && !n.internal) ips.push(n.address);",
            "  }",
            "}",
            "process.stdout.write(ips[0] || '');",
          ].join(""),
        )}`,
        { cwd },
      ).catch(() => null);
      const ip = ipRes?.stdout?.trim();
      if (ip) {
        debugLog("daytona.opencode.ip", { sandboxId: this.id, port: opts.port, ip });
        const externalCheck = await this.exec(
          `curl -sf --max-time 2 ${shellEscape(`http://${ip}:${opts.port}/global/health`)} >/dev/null`,
          { cwd },
        ).catch(() => null);
        if (externalCheck?.code !== 0) {
          const logs = await this.getOpencodeLogs(opts.port).catch(() => null);
          throw new Error(
            [
              `opencode is reachable on localhost but not on the sandbox network interface (${ip}).`,
              `This usually means it is only listening on 127.0.0.1, so Daytona preview URLs will return 502.`,
              logs ? `Session logs:\n${logs.stdout ?? logs.output ?? ""}` : "",
            ].join("\n"),
          );
        }
      }

      return;
    }

    const logs = await this.getOpencodeLogs(opts.port).catch(() => null);
    throw new Error(
      `opencode server failed to start on port ${opts.port}. Session logs:\n${logs?.stdout ?? logs?.output ?? ""}`,
    );
  }

  private async resolveOpencodeSession(port: number): Promise<{ sessionId: string; cmdId: string } | null> {
    const cached = this.opencodeSessions.get(port);
    if (cached) return cached;
    const sessionId = `opencode-${port}`;
    try {
      const session = await this._sandboxInstance.process.getSession(sessionId);
      const commands = session?.commands ?? [];
      const match = commands
        .slice()
        .reverse()
        .find((c: any) => typeof c?.command === "string" && c.command.includes("opencode serve"));
      if (match?.id) {
        const handle = { sessionId, cmdId: match.id };
        this.opencodeSessions.set(port, handle);
        return handle;
      }
    } catch {
      // ignore
    }
    return null;
  }

  async getOpencodeLogs(port: number): Promise<{ output?: string; stdout?: string; stderr?: string }> {
    await this.ensureRunning();
    const handle = await this.resolveOpencodeSession(port);
    if (!handle) return { stdout: "", stderr: "", output: "" };
    return await this._sandboxInstance.process.getSessionCommandLogs(handle.sessionId, handle.cmdId);
  }

  /**
   * Inject a provider credential into the running OpenCode server.
   * This calls the OpenCode `/auth/:provider` endpoint inside the sandbox.
   */
  async injectCredential(port: number, providerID: string, apiKey: string): Promise<boolean> {
    await this.ensureRunning();
    const url = `http://127.0.0.1:${port}/auth/${providerID}`;
    const payload = JSON.stringify({ type: "api", key: apiKey });
    const cmd = `curl -sf -X PUT ${shellEscape(url)} -H "Content-Type: application/json" -d ${shellEscape(payload)}`;
    const res = await this.exec(cmd).catch(() => null);
    return res?.code === 0;
  }

  async listListeningPorts(): Promise<Array<{ port: number; host: string | null; family: "tcp" | "tcp6" }>> {
    await this.ensureRunning();
    const res = await this.exec("cat /proc/net/tcp /proc/net/tcp6 || true");
    const lines = res.stdout.split("\n");
    const out: Array<{ port: number; host: string | null; family: "tcp" | "tcp6" }> = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("sl")) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length < 4) continue;
      const local = parts[1] ?? "";
      const state = parts[3] ?? "";
      if (state !== "0A") continue; // LISTEN
      const [addrHex, portHex] = local.split(":");
      if (!addrHex || !portHex) continue;
      const port = Number.parseInt(portHex, 16);
      if (!Number.isFinite(port)) continue;
      const host = addrHex.length === 8 ? decodeIpv4LittleEndian(addrHex) : null;
      out.push({ port, host, family: addrHex.length === 8 ? "tcp" : "tcp6" });
    }
    // de-dupe by port+host
    const unique = new Map<string, { port: number; host: string | null; family: "tcp" | "tcp6" }>();
    for (const item of out) unique.set(`${item.family}:${item.host ?? ""}:${item.port}`, item);
    return Array.from(unique.values()).sort((a, b) => a.port - b.port);
  }

  async diagnosePort(port: number) {
    await this.ensureRunning();
    const sandbox = this._sandboxInstance as any;

    const result: any = {
      sandboxId: this.id,
      port,
      ports: [],
      preview: {},
      internal: {},
      logs: {},
    };

    result.ports = await this.listListeningPorts().catch(() => []);

    // Preview URLs
    try {
      if (typeof sandbox.getPreviewLink === "function") {
        const p = await sandbox.getPreviewLink(port);
        result.preview.standard = { url: p?.url, token: p?.token };
      }
    } catch (e: any) {
      result.preview.standardError = e?.message || String(e);
    }
    try {
      if (typeof sandbox.getSignedPreviewUrl === "function") {
        const s = await sandbox.getSignedPreviewUrl(port, 60 * 60);
        result.preview.signed = { url: s?.url, token: s?.token };
      }
    } catch (e: any) {
      result.preview.signedError = e?.message || String(e);
    }

    // Determine a non-loopback IP
    const ipRes = await this.exec(
      `node -e ${shellEscape(
        [
          "const os = require('os');",
          "const nets = os.networkInterfaces();",
          "const ips = [];",
          "for (const list of Object.values(nets)) {",
          "  for (const n of (list || [])) {",
          "    if (n && n.family === 'IPv4' && !n.internal) ips.push(n.address);",
          "  }",
          "}",
          "process.stdout.write(ips[0] || '');",
        ].join(""),
      )}`,
    ).catch(() => null);
    const ip = ipRes?.stdout?.trim();
    result.internal.ip = ip || null;

    // Internal health checks
    result.internal.localhostHealth = await this.exec(
      `curl -sS -D - ${shellEscape(`http://127.0.0.1:${port}/global/health`)}`,
      { timeoutSec: 5 },
    ).catch((e) => ({ code: -1, stdout: "", stderr: e?.message || String(e) }));

    if (ip) {
      result.internal.ipHealth = await this.exec(
        `curl -sS -D - ${shellEscape(`http://${ip}:${port}/global/health`)}`,
        { timeoutSec: 5 },
      ).catch((e) => ({ code: -1, stdout: "", stderr: e?.message || String(e) }));
    } else {
      result.internal.ipHealth = null;
    }

    // Session logs snapshot
    result.logs = await this.getOpencodeLogs(port).catch((e: any) => ({
      stdout: "",
      stderr: e?.message || String(e),
      output: "",
    }));

    return result;
  }
}
