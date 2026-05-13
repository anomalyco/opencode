import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { parseOpencodeE2eInfra } from "./e2e-infra"
import { startE2eDockerDeps, startOpencodeE2eContainer } from "./e2e-testcontainers"

/**
 * E2E Test Runner.
 *
 * Infra: `OPENCODE_E2E_INFRA` (default `postgres,ollama`). See `./e2e-infra.ts`.
 * **Docker-backed:** Postgres, Ollama, MinIO, optional univer-compat + OpenCode **API in Bun Testcontainers**
 * (migrate → `seed-e2e` → `Server.listen`). Playwright + Vite stay on the host.
 */

const appDir = process.cwd()
const repoDir = path.resolve(appDir, "../..")
const infra = parseOpencodeE2eInfra()

const extraArgs = (() => {
  const args = process.argv.slice(2)
  if (args[0] === "--") return args.slice(1)
  return args
})()

async function waitForServer(url: string, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  const probe = `${url.replace(/\/+$/, "")}/readyz`
  while (Date.now() < deadline) {
    try {
      const res = await fetch(probe)
      if (res.ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`Server not ready at ${probe} after ${timeoutMs}ms`)
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

console.log("[E2E] Starting Docker-backed E2E dependencies (see e2e-testcontainers.ts)…")
const deps = await startE2eDockerDeps(infra, repoDir)
if (!deps.ollamaInternalBaseUrl) {
  await deps.stop()
  throw new Error(
    "e2e-local runs OpenCode inside Docker; OPENCODE_E2E_INFRA must include `ollama` so opencode.json can use the in-network model base (http://ollama:11434).",
  )
}
const univer = deps.univer
if (univer) console.log(`[E2E] univer-compat at ${univer.origin}`)

const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-e2e-"))
const keepSandbox = process.env.OPENCODE_E2E_KEEP_SANDBOX === "1"

const xdgConfigDir = path.join(sandbox, "config")
const opencodeConfigDir = path.join(xdgConfigDir, "opencode")
await fs.mkdir(opencodeConfigDir, { recursive: true })

const ollamaOpenaiBase = `${deps.ollamaInternalBaseUrl.replace(/\/+$/, "")}/v1`

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

await fs.writeFile(
  path.join(opencodeConfigDir, "opencode.json"),
  JSON.stringify(opencodeConfig, null, 2),
)

const serverPort = await port()
const webPort = await port()
const appOrigin = `http://127.0.0.1:${webPort}`

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

if (univer) {
  runnerEnv.PLAYWRIGHT_E2E_INFRA = "univer"
}

let runner: ReturnType<typeof Bun.spawn> | undefined
let opencodeBox: Awaited<ReturnType<typeof startOpencodeE2eContainer>> | undefined
let cleaned = false

const cleanup = async () => {
  if (cleaned) return
  cleaned = true

  if (runner && runner.exitCode === null) runner.kill("SIGTERM")

  if (opencodeBox !== undefined) await opencodeBox.stop()
  if (!keepSandbox) await fs.rm(sandbox, { recursive: true, force: true })

  await deps.stop()
}

process.once("SIGINT", () => cleanup().then(() => process.exit(130)))
process.once("SIGTERM", () => cleanup().then(() => process.exit(143)))

let code = 1

try {
  console.log("[E2E] Starting OpenCode container (db:migrate → seed-e2e → server)…")
  opencodeBox = await startOpencodeE2eContainer({
    repoRoot: repoDir,
    network: deps.network,
    hostApiPort: serverPort,
    configHostDir: xdgConfigDir,
    env: containerEnv,
  })

  await waitForServer(`http://127.0.0.1:${serverPort}`)
  console.log("[E2E] OpenCode server is ready")

  runner = Bun.spawn(["bun", "test:e2e", ...extraArgs], {
    cwd: appDir,
    env: runnerEnv,
    stdout: "inherit",
    stderr: "inherit",
  })
  code = await runner.exited
} catch (error) {
  console.error(error)
  code = 1
} finally {
  await cleanup()
}

process.exit(code)
