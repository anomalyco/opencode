import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

type Handle = {
  url: string
  stop: () => Promise<void>
}

function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.once("error", reject)
    server.listen(0, () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to acquire a free port")))
        return
      }
      server.close((err) => {
        if (err) reject(err)
        else resolve(address.port)
      })
    })
  })
}

async function waitForHealth(url: string, probe = "/global/health") {
  const end = Date.now() + 120_000
  let last = ""
  while (Date.now() < end) {
    try {
      const res = await fetch(`${url}${probe}`)
      if (res.ok) return
      last = `status ${res.status}`
    } catch (err) {
      last = err instanceof Error ? err.message : String(err)
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for backend health at ${url}${probe}${last ? ` (${last})` : ""}`)
}

async function waitExit(proc: ReturnType<typeof spawn>, timeout = 10_000) {
  if (proc.exitCode !== null) return
  await Promise.race([
    new Promise<void>((resolve) => proc.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, timeout)),
  ])
}

const LOG_CAP = 100

function cap(input: string[]) {
  if (input.length > LOG_CAP) input.splice(0, input.length - LOG_CAP)
}

function tail(input: string[]) {
  return input.slice(-40).join("")
}

export async function startBackend(label: string): Promise<Handle> {
  const port = await freePort()
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), `opencode-e2e-${label}-`))
  const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const repoDir = path.resolve(appDir, "../..")
  const opencodeDir = path.join(repoDir, "packages", "opencode")
  const env = {
    ...process.env,
    OPENCODE_DISABLE_LSP_DOWNLOAD: "true",
    OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
    OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: "true",
    OPENCODE_TEST_HOME: path.join(sandbox, "home"),
    XDG_DATA_HOME: path.join(sandbox, "share"),
    XDG_CACHE_HOME: path.join(sandbox, "cache"),
    XDG_CONFIG_HOME: path.join(sandbox, "config"),
    XDG_STATE_HOME: path.join(sandbox, "state"),
    OPENCODE_CLIENT: "app",
    OPENCODE_STRICT_CONFIG_DEPS: "true",
  } satisfies Record<string, string | undefined>
  const out: string[] = []
  const err: string[] = []
  const proc = spawn(
    "bun",
    ["run", "--conditions=browser", "./src/index.ts", "serve", "--port", String(port), "--hostname", "127.0.0.1"],
    {
      cwd: opencodeDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
  proc.stdout?.on("data", (chunk) => {
    out.push(String(chunk))
    cap(out)
  })
  proc.stderr?.on("data", (chunk) => {
    err.push(String(chunk))
    cap(err)
  })

  const url = `http://127.0.0.1:${port}`
  try {
    await waitForHealth(url)
  } catch (error) {
    proc.kill("SIGTERM")
    await fs.rm(sandbox, { recursive: true, force: true }).catch(() => undefined)
    throw new Error(
      [
        `Failed to start isolated e2e backend for ${label}`,
        error instanceof Error ? error.message : String(error),
        tail(out),
        tail(err),
      ]
        .filter(Boolean)
        .join("\n"),
    )
  }

  return {
    url,
    async stop() {
      if (proc.exitCode === null) {
        proc.kill("SIGTERM")
        await waitExit(proc)
      }
      if (proc.exitCode === null) {
        proc.kill("SIGKILL")
        await waitExit(proc)
      }
      await fs.rm(sandbox, { recursive: true, force: true }).catch(() => undefined)
    },
  }
}
