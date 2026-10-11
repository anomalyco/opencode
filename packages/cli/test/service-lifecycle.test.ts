import { NodeFileSystem } from "@effect/platform-node"
import { Service } from "@opencode/client/effect/service"
import { expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { OPENCODE_VERSION } from "../src/version"
import { isolatedEnv } from "./fixture/environment"

// Real `serve --service` processes driven by the real CLI commands and client. Only behavior that
// needs real processes lives here; the client's lifecycle decisions are covered by fixture tests in
// packages/client/test. Every case ends with exactly one live server, registered and answering on
// the configured port, which a stop removes without leftovers.

const entry = path.join(import.meta.dir, "../src/index.ts")
const serviceTest = process.platform === "win32" ? test.skip : test

serviceTest(
  "concurrent CLI and client starts converge on one server",
  async () => {
    await using home = await serviceHome()

    await Promise.all([
      cli(home, "service", "start"),
      cli(home, "service", "start"),
      ...Array.from({ length: 3 }, () => ensure(home, OPENCODE_VERSION)),
    ])

    await settled(home)
    await stopped(home)
  },
  120_000,
)

serviceTest(
  "racing restarts during concurrent starts leave one new server",
  async () => {
    await using home = await serviceHome()
    await ensure(home)
    const before = await settled(home)

    await Promise.all([
      cli(home, "service", "restart"),
      cli(home, "service", "restart"),
      cli(home, "service", "start"),
      ensure(home),
      ensure(home),
    ])

    const after = await steady(home)
    expect(after.pid).not.toBe(before.pid)
    await exited(before.pid)
    await stopped(home)
  },
  120_000,
)

serviceTest(
  "version-agnostic clients keep an older server until a client requires the new version",
  async () => {
    await using home = await serviceHome()
    const old = Bun.spawn(
      [process.execPath, "--define", 'OPENCODE_VERSION:"2.0.0-old"', home.entry, "serve", "--service"],
      { env: home.env, stdout: "ignore", stderr: "ignore" },
    )
    const before = await settled(home, "2.0.0-old")

    await Promise.all([ensure(home), cli(home, "service", "start")])
    expect((await settled(home, "2.0.0-old")).pid).toBe(before.pid)

    await Promise.all([ensure(home, OPENCODE_VERSION), ensure(home), cli(home, "service", "start")])

    const after = await settled(home)
    expect(after.pid).not.toBe(before.pid)
    await old.exited
    await stopped(home)
  },
  120_000,
)

serviceTest(
  "an old-protocol server survives version-agnostic clients and yields to a required version",
  async () => {
    await using home = await serviceHome()
    await using old = Bun.spawn(
      [
        process.execPath,
        path.join(import.meta.dir, "fixture/old-protocol-service.ts"),
        home.registration,
        String(home.port),
      ],
      { stdout: "ignore", stderr: "inherit" },
    )
    await until(() => snapshot(home).then((state) => state.info))

    await expect(cli(home, "service", "start")).rejects.toThrow("incompatible health protocol")
    await expect(ensure(home)).rejects.toThrow("incompatible health protocol")
    expect(old.exitCode).toBe(null)

    await ensure(home, OPENCODE_VERSION)
    await old.exited
    await settled(home)
    await stopped(home)
  },
  120_000,
)

serviceTest(
  "an unrelated process on the port gets an actionable error, then the service starts",
  async () => {
    await using home = await serviceHome()
    using listener = Bun.serve({ hostname: "127.0.0.1", port: home.port, fetch: () => new Response("unrelated") })

    const conflict = await cli(home, "service", "start").then(
      () => undefined,
      (error: Error) => error.message,
    )
    expect(conflict).toContain(`Managed service port ${home.port} on 127.0.0.1 is already in use by another process`)
    expect(conflict).toContain("opencode service set port <port>")
    expect(await servers(home)).toEqual([])
    expect(await Bun.file(home.registration).exists()).toBe(false)

    await listener.stop(true)
    await cli(home, "service", "start")
    await settled(home)
    await stopped(home)
  },
  120_000,
)

serviceTest(
  "a damaged registration and then a crash each end with one replacement server",
  async () => {
    await using home = await serviceHome()
    await ensure(home)
    const original = await settled(home)

    // The original server keeps the port until its registration self-check notices the damage.
    await fs.writeFile(home.registration, "{")
    await cli(home, "service", "start")
    const replacement = await settled(home)
    expect(replacement.pid).not.toBe(original.pid)
    await exited(original.pid)

    process.kill(replacement.pid, "SIGKILL")
    await exited(replacement.pid)
    await cli(home, "service", "start")
    const recovered = await steady(home)
    expect(recovered.pid).not.toBe(replacement.pid)
    await stopped(home)
  },
  120_000,
)

serviceTest(
  "a server that fails to boot reports the failure without respawning",
  async () => {
    await using home = await serviceHome({ failBoot: true })

    await expect(cli(home, "service", "start")).rejects.toThrow("Background service failed to start")

    // A slow first boot can let a second startup attempt begin; it loses the port and exits.
    const info = await until(() => snapshot(home).then((state) => state.info))
    await observe(home, (state) => state.servers.length === 1 && state.servers[0] === info.pid)
    await stopped(home)
  },
  120_000,
)

type Home = Awaited<ReturnType<typeof serviceHome>>
type Snapshot = Awaited<ReturnType<typeof snapshot>>

async function serviceHome(options: { readonly failBoot?: boolean } = {}) {
  // Bun resolves symlinks in the entry path, so process command lines carry the real directory.
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-lifecycle-")))
  const port = await availablePort()
  await fs.mkdir(path.join(root, "config"), { recursive: true })
  await fs.writeFile(path.join(root, "config", "service-local.json"), JSON.stringify({ port }))
  // A directory where the database file belongs makes boot fail after the server registers.
  if (options.failBoot) await fs.mkdir(path.join(root, "database"))
  // Servers spawned through this home's entry carry its path, so `servers()` sees only this home.
  const homeEntry = path.join(root, "opencode.ts")
  await fs.writeFile(homeEntry, `import ${JSON.stringify(entry)}\n`)
  const overrides = options.failBoot ? { OPENCODE_DB: path.join(root, "database") } : {}
  const home = {
    root,
    port,
    entry: homeEntry,
    registration: path.join(root, "state", "opencode", "service-local.json"),
    env: Object.fromEntries(
      Object.entries(isolatedEnv(root, overrides)).filter((entry): entry is [string, string] => entry[1] !== undefined),
    ),
    async [Symbol.asyncDispose]() {
      // Only a failed case leaves processes behind: servers, or CLI commands that could still spawn one.
      const pids = await processes(homeEntry)
      pids.forEach((pid) => signal(pid, "SIGKILL"))
      await Promise.all(pids.map((pid) => exited(pid).catch(() => undefined)))
      await fs.rm(root, { recursive: true, force: true })
    },
  }
  return home
}

async function cli(home: Home, ...args: string[]) {
  const child = Bun.spawn([process.execPath, home.entry, ...args], { env: home.env, stdout: "pipe", stderr: "pipe" })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (code !== 0) throw new Error(`opencode ${args.join(" ")} exited ${code}: ${stderr.trim()}`)
  return stdout.trim()
}

function ensure(home: Home, version?: string) {
  return Effect.runPromise(
    Service.ensure({
      file: home.registration,
      version,
      command: [process.execPath, home.entry, "serve", "--service"],
      env: home.env,
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  )
}

/** One live server, registered and ready with the expected version on the configured port. */
async function settled(home: Home, version = OPENCODE_VERSION) {
  const state = await observe(home, (state) => isSettled(home, state, version))
  if (state.info === undefined) throw new Error("Settled service has no registration")
  return state.info
}

/** Settled, and still the same server after its registration self-check has run. */
async function steady(home: Home) {
  const info = await settled(home)
  await Bun.sleep(5_500)
  const state = await snapshot(home)
  expect({ settled: isSettled(home, state, OPENCODE_VERSION), id: state.info?.id }).toEqual({
    settled: true,
    id: info.id,
  })
  return info
}

function isSettled(home: Home, state: Snapshot, version: string) {
  return (
    state.info !== undefined &&
    state.info.version === version &&
    new URL(state.info.url).port === String(home.port) &&
    state.answer?.pid === state.info.pid &&
    state.servers.length === 1 &&
    state.servers[0] === state.info.pid
  )
}

async function observe(home: Home, accept: (state: Snapshot) => boolean) {
  const deadline = Date.now() + 30_000
  while (true) {
    const state = await snapshot(home)
    if (accept(state)) return state
    if (Date.now() >= deadline) throw new Error(`Service did not settle: ${JSON.stringify(state)}`)
    await Bun.sleep(100)
  }
}

async function until<A>(read: () => Promise<A | undefined>, timeout = 30_000) {
  const deadline = Date.now() + timeout
  while (true) {
    const value = await read()
    if (value !== undefined) return value
    if (Date.now() >= deadline) throw new Error("Timed out waiting for condition")
    await Bun.sleep(50)
  }
}

/** Stopping leaves no server, no state files, and a free port. */
async function stopped(home: Home) {
  await Effect.runPromise(Service.stop({ file: home.registration }).pipe(Effect.provide(NodeFileSystem.layer)))
  // Allow the OS a moment to reap exited processes; `stop` itself waits for the owner to exit.
  await until(async () => ((await servers(home)).length === 0 ? true : undefined), 2_000).catch(() => undefined)
  expect(await servers(home)).toEqual([])
  expect(await fs.readdir(path.dirname(home.registration)).catch(() => [])).toEqual([])
  const server = Bun.serve({ hostname: "127.0.0.1", port: home.port, fetch: () => new Response() })
  await server.stop(true)
}

async function snapshot(home: Home) {
  const info = await Bun.file(home.registration)
    .json()
    .then(Schema.decodeUnknownPromise(Service.Info))
    .catch(() => undefined)
  const answer =
    info === undefined
      ? undefined
      : await fetch(new URL("/api/info", info.url), {
          headers: Service.headers({
            url: info.url,
            auth:
              info.password === undefined
                ? undefined
                : { type: "basic", username: "opencode", password: info.password },
          }),
          signal: AbortSignal.timeout(1_000),
        })
          // Starting, stopping, and failed servers also report their PID, with a non-200 status.
          .then((response) => (response.ok ? (response.json() as Promise<{ readonly pid?: number }>) : undefined))
          .catch(() => undefined)
  return { info, answer, servers: await servers(home) }
}

/** Every live `serve --service` process started through this home's entry. */
function servers(home: Home) {
  return processes(home.entry + " serve --service")
}

async function processes(pattern: string) {
  const output = await Bun.$`pgrep -f ${pattern}`.nothrow().quiet().text()
  return output.split("\n").filter(Boolean).map(Number)
}

async function exited(pid: number) {
  const deadline = Date.now() + 10_000
  while (signal(pid, 0)) {
    if (Date.now() >= deadline) throw new Error(`Process ${pid} did not exit`)
    await Bun.sleep(25)
  }
}

function signal(pid: number, value: NodeJS.Signals | 0) {
  try {
    process.kill(pid, value)
    return true
  } catch {
    return false
  }
}

async function availablePort() {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
  const port = server.port
  await server.stop(true)
  if (port === undefined) throw new Error("Server did not bind a port")
  return port
}
