import { afterAll, beforeAll } from "vitest"
import { once } from "node:events"
import { spawn, type ChildProcess } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createServer } from "node:net"
import { fileURLToPath } from "node:url"
import { e2eEmit, e2eEmitElapsed } from "../../../e2e/emit"
import { assertHostWorkosForUniverE2e } from "../../../e2e/assert-univer-workos-env"
import { type E2eInfraLayer, parseOpencodeE2eInfra } from "../../../script/e2e-infra-parse"
import { startE2eDockerDeps, startOpencodeE2eContainer } from "../../../script/e2e-testcontainers"

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
/** `@opencode-ai/app` root (`package.json`, `script/dev.ts`, `.env.e2e`). `appDir` is `packages/app/test`. */
const pkgDir = path.resolve(appDir, "..")
/** Monorepo root: must match `startUniverE2e` default (`packages/.../script` → `../../..`). If this pointed at `packages/` only, `/app/packages/univer-compat` in Docker would miss the real `packages/univer-compat`. */
const repoDir = path.resolve(appDir, "..", "..", "..")

function onlyStrings(r: Record<string, string | undefined>): Record<string, string> {
  const o: Record<string, string> = {}
  for (const [k, v] of Object.entries(r)) {
    if (typeof v === "string") o[k] = v
  }
  return o
}

async function pickPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.listen(0, "127.0.0.1", () => {
      const a = s.address()
      if (typeof a === "object" && a && "port" in a) {
        const p = a.port
        s.close((err) => {
          if (err) reject(err)
          else resolve(p)
        })
        return
      }
      reject(new Error("no port"))
    })
    s.on("error", reject)
  })
}

async function waitReadyz(url: string, timeoutMs: number, t0: number, phase: (m: string) => void) {
  const deadline = Date.now() + timeoutMs
  const probe = `${url.replace(/\/+$/, "")}/readyz`
  let last = ""
  let lastLog = 0
  while (Date.now() < deadline) {
    try {
      const res = await fetch(probe)
      if (res.ok) {
        phase(`/readyz OK (${probe})`)
        return
      }
      last = `HTTP ${res.status}`
    } catch (e) {
      last = e instanceof Error ? e.message : "fetch failed"
    }
    const now = Date.now()
    if (now - lastLog > 2500) {
      phase(`polling /readyz — ${last || "no response"} (${probe})`)
      lastLog = now
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`Server not ready at ${probe} after ${timeoutMs}ms (last: ${last})`)
}

async function waitHttpOk(url: string, timeoutMs: number, t0: number, phase: (m: string) => void) {
  const deadline = Date.now() + timeoutMs
  let last = ""
  let lastLog = 0
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5_000) })
      if (res.ok) return
      last = `HTTP ${res.status}`
    } catch (e) {
      last = e instanceof Error ? e.message : "fetch failed"
    }
    const now = Date.now()
    if (now - lastLog > 2500) {
      phase(`polling Vite root — ${last || "no response"} (${url})`)
      lastLog = now
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`Vite not responding at ${url} after ${timeoutMs}ms (last: ${last})`)
}

type Ctx = {
  deps: Awaited<ReturnType<typeof startE2eDockerDeps>> | undefined
  opencode: Awaited<ReturnType<typeof startOpencodeE2eContainer>> | undefined
  vite: ChildProcess | undefined
  sandbox: string
  keepSandbox: boolean
  prev: Record<string, string | undefined>
}

/** Call once at the top of the file's root `describe` (before `useAppWebDriver`). Starts Postgres + **Univer** (MinIO + univer-compat in Testcontainers), OpenCode, Vite; Ollama is **host-only** unless `OPENCODE_E2E_TC_OLLAMA=1`. */
export function useFullAppStack() {
  const ctx: Ctx = {
    deps: undefined,
    opencode: undefined,
    vite: undefined,
    sandbox: "",
    keepSandbox: process.env.OPENCODE_E2E_KEEP_SANDBOX === "1",
    prev: {},
  }

  beforeAll(async () => {
    const t0 = Date.now()
    const phase = (msg: string) => e2eEmitElapsed(t0, "file-e2e-setup", msg)

    const envInfra = parseOpencodeE2eInfra()
    assertHostWorkosForUniverE2e()

    const hookInfra = new Set<E2eInfraLayer>(["postgres", "univer"])
    const tcOllama = process.env.OPENCODE_E2E_TC_OLLAMA === "1"
    if (tcOllama && envInfra.has("ollama")) {
      hookInfra.add("ollama")
      e2eEmit("[file-e2e] OPENCODE_E2E_TC_OLLAMA=1: including Ollama in Testcontainers (large / slow).")
    }
    if (!tcOllama && envInfra.has("ollama")) {
      e2eEmit(
        "[file-e2e] Browser hook skips Testcontainers Ollama; run Ollama on the host (http://127.0.0.1:11434, model llama3.2:1b). For in-Docker Ollama set OPENCODE_E2E_TC_OLLAMA=1.",
      )
    }

    e2eEmit("[file-e2e] Docker deps (Postgres + Univer in TC; Ollama in TC only if OPENCODE_E2E_TC_OLLAMA=1)…")
    ctx.deps = await startE2eDockerDeps(hookInfra, repoDir)
    phase("Docker deps up.")

    const ollamaInDocker = ctx.deps.ollamaInternalBaseUrl
    if (!ollamaInDocker) {
      e2eEmit(
        "[file-e2e] OpenCode container will use host Ollama at http://host.docker.internal:11434/v1 (extra_hosts).",
      )
    }
    const univer = ctx.deps.univer
    if (!univer) throw new Error("Univer stack missing after startE2eDockerDeps (expected Testcontainers univer-compat).")
    e2eEmit(`[file-e2e] univer-compat at ${univer.origin}`)

    ctx.sandbox = await mkdtemp(path.join(os.tmpdir(), "opencode-e2e-"))

    const xdgConfigDir = path.join(ctx.sandbox, "config")
    const opencodeConfigDir = path.join(xdgConfigDir, "opencode")
    await mkdir(opencodeConfigDir, { recursive: true })

    const ollamaRoot = ollamaInDocker ? ollamaInDocker.replace(/\/+$/, "") : "http://host.docker.internal:11434"
    const ollamaOpenaiBase = `${ollamaRoot}/v1`

    const opencodeConfig = {
      model: "openai/llama3.2:1b",
      provider: {
        openai: {
          options: {
            baseURL: ollamaOpenaiBase,
            apiKey: "dummy-key-for-local-model",
          },
          models: {
            "llama3.2:1b": {
              id: "llama3.2:1b",
              name: "Llama 3.2 1B",
              api: {
                id: "llama3.2:1b",
                npm: "@ai-sdk/openai-compatible",
              },
            },
          },
        },
      },
    }

    await writeFile(path.join(opencodeConfigDir, "opencode.json"), JSON.stringify(opencodeConfig, null, 2))
    phase("Wrote sandbox opencode.json.")

    const serverPort = await pickPort()
    const webPort = await pickPort()
    /** Chrome runs inside the Selenium container; loopback there is not the host. */
    const dockerHost = "host.docker.internal"
    const loopback = "127.0.0.1"
    const appOrigin = `http://${dockerHost}:${webPort}`
    const pollViteUrl = `http://${loopback}:${webPort}`
    phase(`Ports: API ${serverPort}, Vite ${webPort} (browser base ${appOrigin}, host poll ${pollViteUrl}).`)

    const serverEnvBase: Record<string, string | undefined> = {
      ...process.env,
      OPENCODE_DISABLE_SHARE: "true",
      OPENCODE_DISABLE_LSP_DOWNLOAD: "true",
      OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
      OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: "true",
      OPENCODE_DISABLE_MODELS_FETCH: "true",
      OPENCODE_WORKOS_ENABLED: "true",
      OTEL_LOG_LEVEL: "none",
      VERITLY_OTLP_EXPORT_DEBUG: "0",
      OPENCODE_E2E_USER_ID: "e2e_test_user",
      OPENCODE_E2E_SESSION_TITLE: "E2E Session",
      OPENCODE_E2E_MESSAGE: "Seeded for UI e2e",
      OPENCODE_E2E_MODEL: "openai/llama3.2:1b",
      OPENCODE_CLIENT: "app",
      PUBLIC_BASE_URL: appOrigin,
      WORKOS_REDIRECT_URI: `${appOrigin}/auth/callback`,
    }

    Object.assign(serverEnvBase, univer.env)

    const containerEnv: Record<string, string | undefined> = {
      ...serverEnvBase,
      DATABASE_URL: ctx.deps.databaseUrlInternal,
    }

    containerEnv.VERITLY_HEALTH_UNIVER_URL = univer.clusterUniverHttpOrigin

    delete containerEnv.VITE_UNIVER_SDK_WS
    delete containerEnv.VERITLY_HEALTH_RELAY_URL

    const runnerEnv: Record<string, string | undefined> = {
      ...serverEnvBase,
      DATABASE_URL: ctx.deps.databaseUrl,
      PLAYWRIGHT_BASE_URL: appOrigin,
      OPENCODE_E2E_API_HOST: loopback,
      PLAYWRIGHT_SERVER_HOST: dockerHost,
      PLAYWRIGHT_SERVER_PORT: String(serverPort),
      VITE_OPENCODE_SERVER_HOST: dockerHost,
      VITE_OPENCODE_SERVER_PORT: String(serverPort),
      PLAYWRIGHT_PORT: String(webPort),
      DEV_FRONTEND_HOST: "0.0.0.0",
      DEV_FRONTEND_PORT: String(webPort),
      DEV_BACKEND_HOST: dockerHost,
      DEV_BACKEND_PORT: String(serverPort),
    }

    phase("OpenCode Testcontainer start…")
    ctx.opencode = await startOpencodeE2eContainer({
      repoRoot: repoDir,
      network: ctx.deps.network,
      hostApiPort: serverPort,
      configHostDir: xdgConfigDir,
      env: containerEnv,
      hostOllama: !ollamaInDocker,
    })
    phase("OpenCode container up.")

    await waitReadyz(`http://127.0.0.1:${serverPort}`, 30_000, t0, phase)

    const bunBin = process.env.VITEST_E2E_BUN?.trim() || "bun"
    const envFileDev = path.join(repoDir, ".env.development")
    const envFileE2e = path.join(pkgDir, ".env.e2e")
    const viteEnv = onlyStrings({
      ...process.env,
      ...runnerEnv,
      DEV_FRONTEND_HOST: "0.0.0.0",
      DEV_FRONTEND_PORT: String(webPort),
      DEV_BACKEND_HOST: dockerHost,
      DEV_BACKEND_PORT: String(serverPort),
      VITE_OPENCODE_SERVER_HOST: dockerHost,
      VITE_OPENCODE_SERVER_PORT: String(serverPort),
    })
    const devScript = path.join(pkgDir, "script", "dev.ts")
    phase(`Spawning Vite (cwd ${pkgDir}, ${devScript}, port ${webPort})…`)
    ctx.vite = spawn(
      bunBin,
      [
        "--env-file",
        envFileDev,
        "--env-file",
        envFileE2e,
        devScript,
        "--",
        "--host",
        "0.0.0.0",
        "--port",
        String(webPort),
      ],
      {
        cwd: pkgDir,
        env: viteEnv,
        stdio: "ignore",
        detached: false,
      },
    )

    await waitHttpOk(pollViteUrl, 120_000, t0, phase)
    phase("Vite responding.")

    const patch = onlyStrings(runnerEnv)
    ctx.prev = {}
    for (const k of Object.keys(patch)) {
      ctx.prev[k] = process.env[k]
      process.env[k] = patch[k]
    }
    phase("process.env patched for this file.")
  }, 420_000)

  afterAll(async () => {
    const td0 = Date.now()
    const td = (msg: string) => e2eEmitElapsed(td0, "file-e2e-teardown", msg)
    for (const [k, v] of Object.entries(ctx.prev)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    if (ctx.vite) {
      ctx.vite.kill("SIGTERM")
      await Promise.race([once(ctx.vite, "close"), new Promise((r) => setTimeout(r, 15_000))])
      td("Vite stopped.")
    }
    if (ctx.opencode) {
      await ctx.opencode.stop()
      td("OpenCode container stopped.")
    }
    if (!ctx.keepSandbox && ctx.sandbox) {
      await rm(ctx.sandbox, { recursive: true, force: true })
      td("Sandbox removed.")
    }
    if (ctx.deps) {
      await ctx.deps.stop()
      td("Docker deps stopped.")
    }
  }, 420_000)
}
