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
  const timeout = Date.now() + 120_000
  const errors: string[] = []
  while (Date.now() < timeout) {
    const result = await fetch(url)
      .then((r) => ({ ok: r.ok, error: undefined }))
      .catch((error) => ({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }))
    if (result.ok) return
    if (result.error) errors.push(result.error)
    await new Promise((r) => setTimeout(r, 250))
  }
  const last = errors.length ? ` (last error: ${errors[errors.length - 1]})` : ""
  throw new Error(`Timed out waiting for server health: ${url}${last}`)
}

async function specs() {
  return Array.fromAsync(new Bun.Glob("e2e/**/*.spec.ts").scan({ cwd: appDir })).then((x) => x.sort())
}

const appDir = process.cwd()
const repoDir = path.resolve(appDir, "../..")
const opencodeDir = path.join(repoDir, "packages", "opencode")
const sync = "e2e/sidebar/sidebar-sync.spec.ts"
const bin = process.execPath
const self = process.argv[1]

const extraArgs = (() => {
  const args = process.argv.slice(2)
  if (args[0] === "--") return args.slice(1)
  return args
})()

async function plan(args: string[]) {
  if (args.length === 0) {
    const all = await specs()
    const rest = all.filter((x) => x !== sync)
    return [rest, [sync]].filter((x) => x.length > 0)
  }

  const files = args.filter((x) => x.endsWith(".spec.ts"))
  const rest = args.filter((x) => !x.endsWith(".spec.ts"))
  if (files.length === 0) return [args]

  const head = files.filter((x) => x !== sync)
  const tail = files.filter((x) => x === sync)
  return [head.length > 0 ? [...rest, ...head] : undefined, tail.length > 0 ? [...rest, ...tail] : undefined].filter(
    (x): x is string[] => !!x,
  )
}

let active: (() => Promise<void>) | undefined

async function fork(args: string[]) {
  if (!self) throw new Error("Failed to resolve e2e-local script path")
  const envPath = [path.dirname(bin), process.env.PATH].filter(Boolean).join(path.delimiter)
  const child = Bun.spawn([bin, self, "--", ...args], {
    cwd: appDir,
    env: {
      ...process.env,
      PATH: envPath,
      OPENCODE_E2E_CHILD: "1",
    },
    stdout: "inherit",
    stderr: "inherit",
  })
  const stop = async () => {
    if (child.exitCode === null) child.kill("SIGTERM")
    await child.exited
  }
  active = stop
  const code = await child.exited
  if (active === stop) active = undefined
  return code
}

async function run(args: string[]) {
  const [serverPort, webPort] = await Promise.all([freePort(), freePort()])
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-e2e-"))
  const keep = process.env.OPENCODE_E2E_KEEP_SANDBOX === "1"
  const envPath = [path.dirname(bin), process.env.PATH].filter(Boolean).join(path.delimiter)
  const serverEnv = {
    ...process.env,
    PATH: envPath,
    OPENCODE_DISABLE_SHARE: process.env.OPENCODE_DISABLE_SHARE ?? "true",
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
    OPENCODE_STRICT_CONFIG_DEPS: "true",
  } satisfies Record<string, string>
  const runnerEnv = {
    ...serverEnv,
    PLAYWRIGHT_SERVER_HOST: "127.0.0.1",
    PLAYWRIGHT_SERVER_PORT: String(serverPort),
    VITE_OPENCODE_SERVER_HOST: "127.0.0.1",
    VITE_OPENCODE_SERVER_PORT: String(serverPort),
    PLAYWRIGHT_PORT: String(webPort),
    ...(args.includes(sync) ? { PLAYWRIGHT_WORKERS: "1" } : {}),
  } satisfies Record<string, string>

  let seed: ReturnType<typeof Bun.spawn> | undefined
  let runner: ReturnType<typeof Bun.spawn> | undefined
  let server: { stop: () => Promise<void> | void } | undefined
  let inst: { Instance: { disposeAll: () => Promise<void> | void } } | undefined
  let done = false

  const cleanup = async () => {
    if (done) return
    done = true

    if (seed && seed.exitCode === null) seed.kill("SIGTERM")
    if (runner && runner.exitCode === null) runner.kill("SIGTERM")

    const jobs = [
      inst?.Instance.disposeAll(),
      server?.stop(),
      keep ? undefined : fs.rm(sandbox, { recursive: true, force: true }),
    ].filter(Boolean)
    await Promise.allSettled(jobs)
  }

  active = cleanup

  let code = 1

  try {
    seed = Bun.spawn([bin, "script/seed-e2e.ts"], {
      cwd: opencodeDir,
      env: serverEnv,
      stdout: "inherit",
      stderr: "inherit",
    })

    const seedExit = await seed.exited
    if (seedExit !== 0) return seedExit

    Object.assign(process.env, serverEnv)
    process.env.AGENT = "1"
    process.env.OPENCODE = "1"
    process.env.OPENCODE_PID = String(process.pid)

    const log = await import("../../opencode/src/util/log")
    const install = await import("../../opencode/src/installation")
    await log.Log.init({
      print: true,
      dev: install.Installation.isLocal(),
      level: "WARN",
    })

    const servermod = await import("../../opencode/src/server/server")
    inst = await import("../../opencode/src/project/instance")
    server = servermod.Server.listen({ port: serverPort, hostname: "127.0.0.1" })
    console.log(`opencode server listening on http://127.0.0.1:${serverPort}`)

    await waitForHealth(`http://127.0.0.1:${serverPort}/global/health`)
    runner = Bun.spawn([bin, "test:e2e", ...args], {
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
    if (active === cleanup) active = undefined
  }

  return code
}

const shutdown = (code: number, reason: string) => {
  process.exitCode = code
  void (active?.() ?? Promise.resolve()).finally(() => {
    active = undefined
    console.error(`e2e-local shutdown: ${reason}`)
    process.exit(code)
  })
}

const reportInternalError = (reason: string, error: unknown) => {
  console.warn(`e2e-local ignored server error: ${reason}`)
  console.warn(error)
}

process.once("SIGINT", () => shutdown(130, "SIGINT"))
process.once("SIGTERM", () => shutdown(143, "SIGTERM"))
process.once("SIGHUP", () => shutdown(129, "SIGHUP"))
process.once("uncaughtException", (error) => {
  reportInternalError("uncaughtException", error)
})
process.once("unhandledRejection", (error) => {
  reportInternalError("unhandledRejection", error)
})

let code = 1

try {
  if (process.env.OPENCODE_E2E_CHILD === "1") {
    code = await run(extraArgs)
  } else {
    const suites = await plan(extraArgs)
    code = 0
    for (let i = 0; i < suites.length; i++) {
      const args = suites[i]
      if (!args) continue
      console.log(`e2e-local suite ${i + 1}/${suites.length}: ${args.join(" ")}`)
      code = suites.length === 1 ? await run(args) : await fork(args)
      if (code !== 0) break
    }
  }
} catch (error) {
  console.error(error)
  code = 1
} finally {
  await (active?.() ?? Promise.resolve())
  active = undefined
}

process.exit(code)
