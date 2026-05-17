import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { e2eEmit, e2eEmitElapsed } from "../e2e/emit"
import { assertHostWorkosForUniverE2e } from "../e2e/assert-univer-workos-env"
import { parseOpencodeE2eInfra, startE2eDockerDeps, startOpencodeE2eContainer } from "./e2e-testcontainers"

/**
 * E2E Test Runner.
 *
 * Infra: `OPENCODE_E2E_INFRA` (default `postgres,ollama`). See `parseOpencodeE2eInfra` in `./e2e-testcontainers.ts`.
 * **Docker-backed:** Postgres, optional in-docker Ollama, optional MinIO + univer-compat + OpenCode **API in Bun Testcontainers**
 * (migrate → `seed-e2e` → `Server.listen`). **Vitest + WebDriver** (`vitest run test/browser`) runs on the host.
 */

const appDir = process.cwd()
const repoDir = path.resolve(appDir, "../..")
const scriptT0 = Date.now()

function phase(msg: string) {
  e2eEmitElapsed(scriptT0, "runner", msg)
}

const infra = parseOpencodeE2eInfra()
if (infra.has("univer")) assertHostWorkosForUniverE2e()

const extraArgs = (() => {
  const args = process.argv.slice(2)
  if (args[0] === "--") return args.slice(1)
  return args
})()

async function waitForServer(url: string, timeoutMs = 30000) {
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
      phase(`still polling /readyz on host — ${last || "no response yet"} (${probe})`)
      lastLog = now
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`Server not ready at ${probe} after ${timeoutMs}ms (last: ${last})`)
}

async function port(): Promise<number> {
  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("ok")
    },
  })
  const raw = server.port
  await server.stop(true)
  if (raw === undefined) throw new Error("ephemeral port unavailable")
  return raw
}

e2eEmit("[runner] Starting Docker-backed E2E dependencies (see e2e-testcontainers.ts)…")
const deps = await startE2eDockerDeps(infra, repoDir)
phase("Docker deps up (Postgres ± Ollama ± Univer).")
const ollamaInDocker = deps.ollamaInternalBaseUrl
if (!ollamaInDocker) {
  e2eEmit(
    "[runner] OPENCODE_E2E_INFRA has no `ollama`; OpenCode uses host Ollama at http://host.docker.internal:11434/v1 (pull llama3.2:1b on the host, or add `ollama` to infra for in-Docker Ollama).",
  )
}
const univer = deps.univer
if (univer) e2eEmit(`[runner] univer-compat at ${univer.origin}`)

const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-e2e-"))
const keepSandbox = process.env.OPENCODE_E2E_KEEP_SANDBOX === "1"

const xdgConfigDir = path.join(sandbox, "config")
const opencodeConfigDir = path.join(xdgConfigDir, "opencode")
await fs.mkdir(opencodeConfigDir, { recursive: true })

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

await fs.writeFile(path.join(opencodeConfigDir, "opencode.json"), JSON.stringify(opencodeConfig, null, 2))
phase("Wrote sandbox opencode.json.")

const serverPort = await port()
const webPort = await port()
const appOrigin = `http://127.0.0.1:${webPort}`
phase(`Picked ports: API ${serverPort}, Vite ${webPort}.`)

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

if (univer) {
  Object.assign(serverEnvBase, univer.env)
}

const containerEnv: Record<string, string | undefined> = {
  ...serverEnvBase,
  DATABASE_URL: deps.databaseUrlInternal,
}

if (univer) {
  containerEnv.VERITLY_HEALTH_UNIVER_URL = univer.clusterUniverHttpOrigin
}

delete containerEnv.VITE_UNIVER_SDK_WS
delete containerEnv.VERITLY_HEALTH_RELAY_URL

const runnerEnv: Record<string, string | undefined> = {
  ...serverEnvBase,
  DATABASE_URL: deps.databaseUrl,
  PLAYWRIGHT_BASE_URL: appOrigin,
  PLAYWRIGHT_SERVER_HOST: "127.0.0.1",
  PLAYWRIGHT_SERVER_PORT: String(serverPort),
  VITE_OPENCODE_SERVER_HOST: "127.0.0.1",
  VITE_OPENCODE_SERVER_PORT: String(serverPort),
  PLAYWRIGHT_PORT: String(webPort),
}

let opencodeBox: Awaited<ReturnType<typeof startOpencodeE2eContainer>> | undefined
let cleaned = false

const cleanup = async () => {
  if (cleaned) return
  cleaned = true

  if (opencodeBox !== undefined) await opencodeBox.stop()
  if (!keepSandbox) await fs.rm(sandbox, { recursive: true, force: true })

  await deps.stop()
}

process.once("SIGINT", () => cleanup().then(() => process.exit(130)))
process.once("SIGTERM", () => cleanup().then(() => process.exit(143)))

let code = 1

try {
  phase("OpenCode Testcontainer: start() next (blocks on migrate + seed + in-container GET /readyz 200, timeout 300s).")
  opencodeBox = await startOpencodeE2eContainer({
    repoRoot: repoDir,
    network: deps.network,
    hostApiPort: serverPort,
    configHostDir: xdgConfigDir,
    env: containerEnv,
    hostOllama: !ollamaInDocker,
  })
  phase("OpenCode Testcontainer start() returned (Testcontainers HTTP wait satisfied).")

  phase("Host polling /readyz (redundant sanity check).")
  await waitForServer(`http://127.0.0.1:${serverPort}`)
  e2eEmit("[runner] OpenCode server is ready")

  const vitestTargets = extraArgs.length > 0 ? extraArgs : ["test/browser"]
  const vitestCli = ["run", ...vitestTargets]
  phase(`Spawning: bun x vitest ${vitestCli.join(" ")}`)
  const wdRunner = Bun.spawn(["bun", "x", "vitest", ...vitestCli], {
    cwd: appDir,
    env: runnerEnv,
    stdout: "inherit",
    stderr: "inherit",
  })
  code = await wdRunner.exited
  phase(`Vitest browser finished (exit ${code}).`)
} catch (error) {
  console.error(error)
  code = 1
} finally {
  await cleanup()
}

process.exit(code)
