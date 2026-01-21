import fs from "node:fs/promises"
import net from "node:net"
import os from "node:os"
import path from "node:path"

async function freePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.once("error", reject)
    server.listen(0, () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to acquire a free port")))
        return
      }
      server.close((err) => {
        if (err) {
          reject(err)
          return
        }
        resolve(address.port)
      })
    })
  })
}

async function waitForHealth(url: string) {
  const timeout = Date.now() + 60_000
  while (Date.now() < timeout) {
    const ok = await fetch(url)
      .then((r) => r.ok)
      .catch(() => false)
    if (ok) return
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`Timed out waiting for server health: ${url}`)
}

const appDir = process.cwd()
const repoDir = path.resolve(appDir, "../..")
const opencodeDir = path.join(repoDir, "packages", "opencode")
const modelsJson = path.join(opencodeDir, "test", "tool", "fixtures", "models-api.json")

const extraArgs = (() => {
  const args = process.argv.slice(2)
  if (args[0] === "--") return args.slice(1)
  return args
})()

const [serverPort, webPort] = await Promise.all([freePort(), freePort()])

const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-e2e-"))

const serverEnv = {
  ...process.env,
  MODELS_DEV_API_JSON: modelsJson,
  OPENCODE_DISABLE_MODELS_FETCH: "true",
  OPENCODE_DISABLE_SHARE: "true",
  OPENCODE_DISABLE_LSP_DOWNLOAD: "true",
  OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
  OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: "true",
  OPENCODE_TEST_HOME: path.join(sandbox, "home"),
  XDG_DATA_HOME: path.join(sandbox, "share"),
  XDG_CACHE_HOME: path.join(sandbox, "cache"),
  XDG_CONFIG_HOME: path.join(sandbox, "config"),
  XDG_STATE_HOME: path.join(sandbox, "state"),
  OPENCODE_E2E_PROJECT_DIR: repoDir,
  OPENCODE_E2E_SESSION_TITLE: "E2E Session",
  OPENCODE_E2E_MESSAGE: "Seeded for UI e2e",
  OPENCODE_E2E_MODEL: "opencode/gpt-5-nano",
  OPENCODE_CLIENT: "app",
} satisfies Record<string, string>

const runnerEnv = {
  ...process.env,
  PLAYWRIGHT_SERVER_HOST: "127.0.0.1",
  PLAYWRIGHT_SERVER_PORT: String(serverPort),
  VITE_OPENCODE_SERVER_HOST: "127.0.0.1",
  VITE_OPENCODE_SERVER_PORT: String(serverPort),
  PLAYWRIGHT_PORT: String(webPort),
} satisfies Record<string, string>

const seed = Bun.spawn(["bun", "script/seed-e2e.ts"], {
  cwd: opencodeDir,
  env: serverEnv,
  stdout: "inherit",
  stderr: "inherit",
})

const seedExit = await seed.exited
if (seedExit !== 0) {
  process.exit(seedExit)
}

const server = Bun.spawn(
  [
    "bun",
    "dev",
    "--",
    "--print-logs",
    "--log-level",
    "WARN",
    "serve",
    "--port",
    String(serverPort),
    "--hostname",
    "127.0.0.1",
  ],
  {
    cwd: opencodeDir,
    env: serverEnv,
    stdout: "inherit",
    stderr: "inherit",
  },
)

try {
  await waitForHealth(`http://127.0.0.1:${serverPort}/global/health`)

  const runner = Bun.spawn(["bun", "test:e2e", ...extraArgs], {
    cwd: appDir,
    env: runnerEnv,
    stdout: "inherit",
    stderr: "inherit",
  })

  process.exitCode = await runner.exited
} finally {
  server.kill()
}
