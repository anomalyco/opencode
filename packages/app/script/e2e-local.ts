import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

/**
 * E2E Test Runner - Docker Compose Edition
 * 
 * PREREQUISITES (run these first):
 *   ./script/setup-e2e.sh
 * 
 * This script DOES NOT start containers. It FAILS FAST if services are unavailable.
 */

const appDir = process.cwd()
const repoDir = path.resolve(appDir, "../..")
const opencodeDir = path.join(repoDir, "packages", "opencode")

const extraArgs = (() => {
  const args = process.argv.slice(2)
  if (args[0] === "--") return args.slice(1)
  return args
})()

// Service endpoints - must match docker-compose.e2e.yml
const services = {
  postgres: { url: "postgresql://veritly:veritly@localhost:15432/veritly", type: "database" },
  ollama: { url: "http://localhost:11435", type: "http" },
  executor: { url: "http://localhost:18080", type: "http" },
}

// Fail-fast health checks
async function checkServices(): Promise<string[]> {
  const errors: string[] = []
  
  for (const [name, config] of Object.entries(services)) {
    try {
      if (config.type === "http") {
        let res: Response
        if (name === "ollama") {
          // Ollama uses /api/tags for health check
          res = await fetch(`${config.url}/api/tags`)
        } else {
          // Executor uses /readyz
          res = await fetch(`${config.url}/readyz`)
        }
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }
      }
      console.log(`[E2E] ✓ ${name} is available`)
    } catch (e) {
      errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  
  return errors
}

async function waitForServer(url: string, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/global/readyz`)
      if (res.ok) return
    } catch {}
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error(`Server not ready at ${url} after ${timeoutMs}ms`)
}

// Main
console.log("[E2E] Checking prerequisites...")
console.log("[E2E] Run ./script/setup-e2e.sh if services are not available")
console.log("")

const errors = await checkServices()

if (errors.length > 0) {
  console.error("[E2E] ✗ Required services are not available:")
  for (const err of errors) {
    console.error(`  - ${err}`)
  }
  console.error("")
  console.error("[E2E] Run: ./script/setup-e2e.sh")
  process.exit(1)
}

// Get Ollama model info
const ollamaRes = await fetch("http://localhost:11435/api/tags")
const ollamaData = await ollamaRes.json()
const models = ollamaData.models?.map((m: any) => m.name) || []
console.log(`[E2E] Available models: ${models.join(", ")}`)

if (!models.includes("llama3.2:1b")) {
  console.error("[E2E] ✗ Model llama3.2:1b not found in Ollama")
  console.error("[E2E] Run: docker compose -f docker-compose.e2e.yml exec ollama ollama pull llama3.2:1b")
  process.exit(1)
}

const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-e2e-"))
const keepSandbox = process.env.OPENCODE_E2E_KEEP_SANDBOX === "1"

// Create static config pointing to Compose services
const xdgConfigDir = path.join(sandbox, "config")
const opencodeConfigDir = path.join(xdgConfigDir, "opencode")
await fs.mkdir(opencodeConfigDir, { recursive: true })

const opencodeConfig = {
  model: "openai/llama3.2:1b",
  provider: {
    openai: {
      options: {
        baseURL: "http://localhost:11435/v1",
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

const serverPort = 14096
const webPort = 3000

const serverEnv = {
  ...process.env,
  OPENCODE_DISABLE_SHARE: "true",
  OPENCODE_DISABLE_LSP_DOWNLOAD: "true",
  OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
  OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: "true",
  OPENCODE_DISABLE_MODELS_FETCH: "true",
  OPENCODE_WORKOS_ENABLED: "true",
  OPENCODE_TEST_HOME: path.join(sandbox, "home"),
  XDG_DATA_HOME: path.join(sandbox, "share"),
  XDG_CACHE_HOME: path.join(sandbox, "cache"),
  XDG_CONFIG_HOME: xdgConfigDir,
  XDG_STATE_HOME: path.join(sandbox, "state"),
  OPENCODE_E2E_PROJECT_DIR: repoDir,
  OPENCODE_E2E_USER_ID: "e2e_test_user",
  OPENCODE_E2E_SESSION_TITLE: "E2E Session",
  OPENCODE_E2E_MESSAGE: "Seeded for UI e2e",
  OPENCODE_E2E_MODEL: "openai/llama3.2:1b",
  OPENCODE_CLIENT: "app",
  VERITLY_EXECUTOR_URL: "http://localhost:18080",
  DATABASE_URL: "postgresql://veritly:veritly@localhost:15432/veritly",
}

const runnerEnv = {
  ...serverEnv,
  PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${webPort}`,
  PLAYWRIGHT_SERVER_HOST: "127.0.0.1",
  PLAYWRIGHT_SERVER_PORT: String(serverPort),
  VITE_OPENCODE_SERVER_HOST: "127.0.0.1",
  VITE_OPENCODE_SERVER_PORT: String(serverPort),
  PLAYWRIGHT_PORT: String(webPort),
}

let seed: ReturnType<typeof Bun.spawn> | undefined
let runner: ReturnType<typeof Bun.spawn> | undefined
let server: { stop: () => Promise<void> | void } | undefined
let inst: { Instance: { disposeAll: () => Promise<void> | void } } | undefined
let cleaned = false

const cleanup = async () => {
  if (cleaned) return
  cleaned = true

  if (seed && seed.exitCode === null) seed.kill("SIGTERM")
  if (runner && runner.exitCode === null) runner.kill("SIGTERM")

  const jobs = [
    inst?.Instance.disposeAll(),
    server?.stop(),
    keepSandbox ? undefined : fs.rm(sandbox, { recursive: true, force: true }),
  ].filter(Boolean)
  await Promise.allSettled(jobs)
}

process.once("SIGINT", () => cleanup().then(() => process.exit(130)))
process.once("SIGTERM", () => cleanup().then(() => process.exit(143)))

let code = 1

try {
  console.log("[E2E] Seeding database...")
  seed = Bun.spawn(["bun", "script/seed-e2e.ts"], {
    cwd: opencodeDir,
    env: serverEnv,
    stdout: "inherit",
    stderr: "inherit",
  })

  const seedExit = await seed.exited
  if (seedExit !== 0) {
    console.error("[E2E] Seed failed!")
    code = seedExit
  } else {
    Object.assign(process.env, serverEnv)
    process.env.AGENT = "1"
    process.env.OPENCODE = "1"
    process.env.OPENCODE_PID = String(process.pid)

    const log = await import("../../opencode/src/util/log")
    await log.Log.init({
      print: true,
      dev: true,
      level: "WARN",
    })

    const servermod = await import("../../opencode/src/server/server")
    inst = await import("../../opencode/src/project/instance")
    server = servermod.Server.listen({ port: serverPort, hostname: "127.0.0.1" })
    console.log(`[E2E] OpenCode server listening on http://127.0.0.1:${serverPort}`)
    
    // Wait for server to be ready
    await waitForServer(`http://127.0.0.1:${serverPort}`)
    console.log("[E2E] Server is ready")

    runner = Bun.spawn(["bun", "test:e2e", ...extraArgs], {
      cwd: appDir,
      env: runnerEnv,
      stdout: "inherit",
      stderr: "inherit",
    })
    code = await runner.exited
  }
} catch (error) {
  console.error(error)
  code = 1
} finally {
  await cleanup()
}

process.exit(code)
