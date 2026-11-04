// P-APP, TypeScript side (docs/H.2.md): records every parity/scenarios/*/*.app.ts through the whole TS TUI in
// createAppFixture. Writes parity/fixtures/<step>/<name>.app.json and one cell file per checkpoint.
// `PARITY_SCENARIO=<step>/<name>` selects one scenario.
import { test } from "bun:test"
import { Database } from "bun:sqlite"
import type { ServerWebSocket } from "bun"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createAppFixture } from "../../../tui/test/fixture/app"
import { createFetch, directory } from "../../../tui/test/fixture/tui-client"
import { applyMasks, withNewDesigns, type AppScenario, type Route, type Step } from "../lib/app"
import { readCells, writeFixture, type Fixture } from "../lib/cells"
import { installFakePty } from "../lib/pty-socket"

// Session lists group by local date; UTC keeps the recorded cells the same on every machine.
process.env.TZ = "UTC"
const parity = new URL("..", import.meta.url).pathname
const only = process.env.PARITY_SCENARIO
const files = Array.from(new Bun.Glob("scenarios/*/*.app.ts").scanSync({ cwd: parity }))
  .sort()
  .filter((file) => !only || file === `scenarios/${only}.app.ts`)

const STARTUP_READS_MS = 1_500

type Setup = Awaited<ReturnType<typeof createAppFixture>>
type Logged = {
  method: string
  path: string
  query: Record<string, string[]>
  body?: unknown
  status: number
  json?: unknown
  text?: string
  contentType?: string
  unmatched?: true
}

for (const file of files) {
  const name = file.slice("scenarios/".length, -".app.ts".length)
  // The cold import of src/app takes seconds on a loaded machine; each checkpoint may wait 5 s.
  test(name, () => record(name, file), 60_000)
}

async function record(name: string, file: string) {
  const scenario: AppScenario = (await import(`${parity}${file}`)).default
  const config = withNewDesigns({ ...scenario.config, animations: false })
  const routes = scenario.routes ?? []
  const defaults = createFetch().fetch
  const log: Logged[] = []
  await using ide = scenario.ide ? startIde() : undefined
  await using zed = scenario.zed ? await zedDatabase(scenario.zed.sql) : undefined
  const env = {
    ...scenario.env,
    ...(ide ? { OPENCODE_EDITOR_SSE_PORT: String(ide.port) } : {}),
    ...(zed ? { ZED_TERM: "true", OPENCODE_ZED_DB: zed.db, HOME: zed.home } : {}),
  }
  const saved = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]))
  Object.assign(process.env, env)
  await using _env = {
    [Symbol.asyncDispose]: async () =>
      Object.entries(saved).forEach(([key, value]) =>
        value === undefined ? delete process.env[key] : (process.env[key] = value),
      ),
  }
  let index = 0
  const pty = scenario.pty ? installFakePty(scenario.pty, () => index) : undefined
  await using _pty = { [Symbol.asyncDispose]: async () => pty?.restore() }
  await using setup = await createAppFixture({
    width: scenario.width ?? 100,
    height: scenario.height ?? 30,
    config,
    args: scenario.args ?? {},
    fetch: async (url, request) => {
      // The fixture serves its own event stream.
      if (url.pathname === "/api/event") return undefined
      const body = request.body ? await request.clone().text() : ""
      const route = routes.find((route) => matches(route, request.method, url.pathname))
      const response = route
        ? respond(route)
        : await defaults(request).catch(
            (error: Error) => new Response(JSON.stringify({ message: error.message }), { status: 500 }),
          )
      log.push({
        method: request.method,
        path: url.pathname,
        query: query(url),
        ...(body ? { body: parse(body) } : {}),
        ...(await logged(response.clone())),
        ...(!route && response.status === 500 ? { unmatched: true as const } : {}),
      })
      return response
    },
  })
  await setup.ready
  const started = Date.now()
  const steps: (Step & { fixture?: string })[] = []
  for (const [stepIndex, step] of scenario.steps.entries()) {
    index = stepIndex
    if ("pty" in step) pty?.step(step.pty)
    if ("keys" in step) step.keys.forEach((key) => press(setup, key))
    if ("type" in step) await setup.mockInput.typeText(step.type)
    if ("click" in step) await setup.mockMouse.click(...step.click)
    if ("event" in step) setup.events.emit(step.event as never)
    if ("drag" in step) await setup.mockMouse.drag(...step.drag[0], ...step.drag[1])
    if ("ide" in step) {
      if (!ide) throw new Error(`${name}: an ide step needs \`ide: true\``)
      await ide.notify(step.ide)
    }
    if (!("checkpoint" in step)) {
      steps.push(step)
      continue
    }
    const cells = applyMasks(await settle(setup, step.until, `${name}/${step.checkpoint}`), step.masks ?? [])
    const fixture = `${name}/${step.checkpoint}`
    await writeFixture(`${parity}fixtures/${fixture}.json`, cells)
    steps.push({ ...step, fixture })
  }
  // The migration status poll starts 1 s after mount (src/component/migration-overlay.tsx:19). Staying open
  // past it records it in every scenario, however fast the steps ran.
  await Bun.sleep(Math.max(0, STARTUP_READS_MS - (Date.now() - started)))
  const unmatched = log.filter((entry) => entry.unmatched)
  if (unmatched.length > 0)
    throw new Error(
      `${name}: no route or default for ${unmatched.map((entry) => `${entry.method} ${entry.path}`).join(", ")}`,
    )
  const recording = {
    scenario: name,
    width: scenario.width ?? 100,
    height: scenario.height ?? 30,
    directory,
    config,
    args: scenario.args ?? {},
    ...(scenario.env ? { env: scenario.env } : {}),
    routes,
    ...(ide ? { ide: ide.received } : {}),
    ...(scenario.zed ? { zed: scenario.zed } : {}),
    steps,
    ...(pty ? { sockets: pty.recordings } : {}),
    ...(scenario.requests ? { deviation: scenario.requests.deviation } : {}),
    requests: {
      writes: log.filter((entry) => !isRead(entry)),
      reads: dedupe(log.filter(isRead)),
    },
  }
  await Bun.write(`${parity}fixtures/${name}.app.json`, JSON.stringify(recording, null, 2) + "\n")
}

// A fake IDE MCP server (E.5): it answers `initialize`, keeps every message a client sends, and pushes
// notifications to the clients that finished the handshake.
function startIde() {
  const received: unknown[] = []
  const ready = new Set<ServerWebSocket<unknown>>()
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request, server) => (server.upgrade(request) ? undefined : new Response("websocket only", { status: 400 })),
    websocket: {
      message(socket, data) {
        const message = JSON.parse(String(data))
        received.push(message)
        if (message.method === "initialize")
          socket.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              result: { protocolVersion: "2025-11-25", serverInfo: { name: "fake-ide", version: "1" } },
            }),
          )
        if (message.method === "notifications/initialized") ready.add(socket)
      },
      close(socket) {
        ready.delete(socket)
      },
    },
  })
  return {
    port: server.port,
    received,
    async notify(message: { method: string; params?: unknown }) {
      const deadline = Date.now() + 5_000
      while (ready.size === 0 && Date.now() < deadline) await Bun.sleep(25)
      if (ready.size === 0) throw new Error("no IDE client finished the MCP handshake within 5s")
      ready.forEach((socket) => socket.send(JSON.stringify({ jsonrpc: "2.0", ...message })))
    },
    async [Symbol.asyncDispose]() {
      await server.stop(true)
    },
  }
}

// A Zed database for the scenario in a temporary directory, which is also HOME, so no IDE lock file of the
// machine is read.
async function zedDatabase(sql: string) {
  const home = await mkdtemp(path.join(tmpdir(), "opencode-parity-zed-"))
  const db = path.join(home, "db.sqlite")
  const database = new Database(db)
  database.exec(sql)
  database.close()
  return {
    home,
    db,
    async [Symbol.asyncDispose]() {
      await rm(home, { recursive: true, force: true })
    },
  }
}

// The frame is ready when it contains `until` and three polls in a row read the same cells; colors settle
// after the text when highlighting finishes.
async function settle(setup: Setup, until: string | undefined, label: string): Promise<Fixture> {
  const deadline = Date.now() + 5_000
  let previous = ""
  let same = 0
  while (Date.now() < deadline) {
    await Bun.sleep(30)
    const cells = read(setup)
    if (!cells) continue
    const key = JSON.stringify(cells)
    same = key === previous ? same + 1 : 0
    previous = key
    if (same >= 2 && (!until || setup.captureCharFrame().includes(until))) return cells
  }
  throw new Error(
    `${label}: no settled frame${until ? ` with ${JSON.stringify(until)}` : ""} within 5s:\n${setup.captureCharFrame()}`,
  )
}

// The renderer is started, so a frame in progress holds the buffer lease; that poll is skipped.
function read(setup: Setup) {
  try {
    return readCells(setup.renderer.currentRenderBuffer)
  } catch (error) {
    if (error instanceof Error && error.message.includes("OutputBusy")) return undefined
    throw error
  }
}

const NAMED: Record<string, string> = {
  enter: "RETURN",
  return: "RETURN",
  escape: "ESCAPE",
  esc: "ESCAPE",
  tab: "TAB",
  backspace: "BACKSPACE",
  delete: "DELETE",
  home: "HOME",
  end: "END",
  up: "ARROW_UP",
  down: "ARROW_DOWN",
  left: "ARROW_LEFT",
  right: "ARROW_RIGHT",
  space: " ",
  // The mock has no key codes for these; it writes the raw sequences.
  pageup: "\u001b[5~",
  pagedown: "\u001b[6~",
}

function press(setup: Setup, shortcut: string) {
  const parts = shortcut.split("+")
  const key = parts.pop()!
  const modifiers = {
    ctrl: parts.includes("ctrl"),
    shift: parts.includes("shift"),
    meta: parts.includes("alt") || parts.includes("meta"),
  }
  const named = NAMED[key.toLowerCase()] ?? (/^f\d+$/i.test(key) ? key.toUpperCase() : undefined)
  if (!named && [...key].length !== 1) throw new Error(`unknown key ${JSON.stringify(shortcut)}`)
  setup.mockInput.pressKey(named ?? key, modifiers)
}

function matches(route: Route, method: string, path: string) {
  if ((route.method ?? "GET").toUpperCase() !== method) return false
  const want = route.path.split("/")
  const have = path.split("/")
  return want.length === have.length && want.every((part, index) => part.startsWith(":") || part === have[index])
}

function respond(route: Route) {
  const status = route.status ?? 200
  if (route.json !== undefined) return Response.json(route.json, { status, headers: route.headers })
  if (route.body !== undefined)
    return new Response(route.body, { status, headers: { "content-type": "text/plain", ...route.headers } })
  return new Response(null, { status: route.status ?? 204, headers: route.headers })
}

function query(url: URL) {
  return [...new Set(url.searchParams.keys())].toSorted().reduce<Record<string, string[]>>(
    (all, key) => ({
      ...all,
      // The startup probe sends the runner's working directory.
      [key]: url.searchParams.getAll(key).map((value) => (value === process.cwd() ? "<cwd>" : value)),
    }),
    {},
  )
}

async function logged(response: Response) {
  const contentType = response.headers.get("content-type") ?? undefined
  const text = await response.text()
  if (contentType?.includes("json") && text) return { status: response.status, json: JSON.parse(text) }
  return { status: response.status, ...(text ? { text, contentType } : {}) }
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

// A GET, or a plugin RPC named `get` (the goal footer posts one); the same rule as `is_read` in
// crates/parity/src/app.rs.
function isRead(entry: Logged) {
  return entry.method === "GET" || /^\/api\/rpc\/[^/]+\/get$/.test(entry.path)
}

function dedupe(entries: Logged[]) {
  const key = (entry: Logged) => JSON.stringify([entry.method, entry.path, entry.query, entry.body])
  const seen = new Map<string, Logged>()
  for (const entry of entries) if (!seen.has(key(entry))) seen.set(key(entry), entry)
  return [...seen.entries()].toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, entry]) => entry)
}
