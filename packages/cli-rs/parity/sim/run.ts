// P-TUI runner (docs/testing.md):
//
//   bun run --cwd packages/cli-rs parity:sim [--sides ts,rs] [parity/scenarios/<step>/<name>.sim.ts ...]
//
// Each side runs alone against its own simulated TS server, backend driver, and recording proxy, in a sandbox that
// never touches the user's config, state, or service. Every process a side starts is killed when the side ends,
// when the run fails, and when the runner exits.
import { cp, mkdir, rm, stat, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { Schema } from "effect"
import { Frontend, Handshake } from "@opencode/protocol/simulation"
import { applyMasks } from "../lib/app"
import { writeFixture, type Fixture } from "../lib/cells"
import { buildRust, command, parseSides, parityRoot, sandbox, type Sandbox, type Side } from "../cli/client"
import { startBackend, type Invocation, type Reply } from "./backend"
import { allows, compareFixtures, compareRequests, text, toFixture } from "./compare"
import { connectDrive } from "./drive"
import { startProxy, type Logged } from "./proxy"
import type { SimScenario, Step } from "./scenario"

// The whole run, after which the runner stops every process and fails. The caller's `timeout -s KILL` should be
// longer, so this cleanup runs first.
const RUN_DEADLINE = Number(process.env.PARITY_SIM_DEADLINE ?? 240_000)
const WAIT = 30_000
const password = "sim-parity"
const CLOCK = path.join(import.meta.dir, "clock.ts")
// The instant at which a side's simulated clock starts, shared by its server and client through the side's real
// start (`OPENCODE_DRIVE_SINCE`), so their message IDs sort on one timeline. A scenario's date must not depend on when
// the run happens: the server derives its `core/date` instruction from it, and a run that crosses midnight would
// change that instruction between the two sides' servers, which start seconds apart, so only one screen would show
// the "Instructions updated" row (H.2/session-open, 20261127-234831). 06:00 UTC is at least six hours from local
// midnight in every time zone, and a run ends long before it. `scenario.now` overrides it for a screen that shows a
// date.
const DEFAULT_NOW = Date.UTC(2026, 5, 17, 6)
// Both sides of a run share the sandbox path, so it never differs between them; masking its random name keeps the
// committed captures the same from run to run.
// Read only: each side gets a copy.
const GRAMMAR_CACHE =
  process.env.PARITY_GRAMMAR_CACHE ??
  path.join(process.env.XDG_DATA_HOME ?? path.join(homedir(), ".local/share"), "opentui", "tree-sitter")
const SANDBOX_MASK = { line: "opencode-parity-[A-Za-z0-9]{6}", reason: "the sandbox name is random" }

const children = new Set<{ kill(signal?: number): void }>()
const stopAll = () => children.forEach((child) => child.kill(9))
process.on("exit", stopAll)
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
  process.on(signal, () => {
    stopAll()
    process.exit(130)
  })
setTimeout(() => {
  console.error(`parity:sim: the run took longer than ${RUN_DEADLINE} ms; stopping`)
  stopAll()
  process.exit(124)
}, RUN_DEADLINE).unref()

const argv = process.argv.slice(2)
const sidesFlag = argv.indexOf("--sides")
const sides = parseSides(sidesFlag === -1 ? undefined : argv[sidesFlag + 1])
const files = argv.filter((arg, index) => !arg.startsWith("--") && (sidesFlag === -1 || index !== sidesFlag + 1))
const scenarios = files.length
  ? files.map((file) => path.resolve(file))
  : [...new Bun.Glob("scenarios/*/*.sim.ts").scanSync({ cwd: parityRoot, absolute: true })].toSorted()

await buildRust(sides)
let failed = false
for (const file of scenarios) {
  const name = path.relative(path.join(parityRoot, "scenarios"), file).replace(/\.sim\.ts$/, "")
  const scenario: SimScenario = (await import(file)).default
  const ok = await runScenario(name, scenario).catch((error: Error) => {
    console.log(`FAIL ${name}\n  ${error.stack ?? error.message}`)
    return false
  })
  failed ||= !ok
}
stopAll()
process.exit(failed ? 1 : 0)

async function runScenario(name: string, scenario: SimScenario) {
  const box = await sandbox({ OPENCODE_PASSWORD: password })
  const labels = sides[0] === sides[1] ? [sides[0], `${sides[1]}2`] : sides
  const results = []
  for (const [index, side] of sides.entries()) results.push(await runSide(box, side, labels[index], scenario))
  // Run outputs, ignored by git: nothing reads them, they are for a person to look at after a run.
  const out = path.join(parityRoot, "out", name.replace(/\//g, path.sep) + ".sim")
  await rm(out, { recursive: true, force: true })
  await mkdir(out, { recursive: true })
  const checkpoints = scenario.steps.filter((step) => "checkpoint" in step)
  const lines: string[] = []
  const report: Record<string, unknown> = { scenario: name, sides: labels }
  let ok = true
  for (const checkpoint of checkpoints) {
    const [a, b] = results.map((result) => result.captures[checkpoint.checkpoint])
    for (const [index, fixture] of [a, b].entries()) {
      await writeFixture(path.join(out, `${checkpoint.checkpoint}.${labels[index]}.json`), fixture)
      await writeFile(path.join(out, `${checkpoint.checkpoint}.${labels[index]}.txt`), text(fixture) + "\n")
    }
    const comparison = compareFixtures(a, b)
    const deviation = checkpoint.deviation ?? []
    const missing = deviation.map((entry) => entry.file).filter((file) => !deviationExists(file))
    const allowed = allows(deviation, comparison)
    const pass = missing.length === 0 && allowed
    ok &&= pass
    const named = JSON.stringify(deviation)
    const verdict =
      deviation.length === 0
        ? "differs"
        : comparison.equal
          ? `remove the deviations ${named}`
          : allowed
            ? `differs, allowed by ${named}`
            : `differs beyond ${named}`
    const summary =
      comparison.equal && deviation.length === 0 ? comparison.report : `${comparison.report.split("\n")[0]}; ${verdict}`
    lines.push(`  checkpoint ${checkpoint.checkpoint}: ${summary}`)
    if (missing.length) lines.push(`    deviation files missing: ${JSON.stringify(missing)}`)
    if (!pass || process.env.PARITY_VERBOSE) lines.push(indent(comparison.report, 4))
    report[checkpoint.checkpoint] = {
      equal: comparison.equal,
      differences: comparison.differences,
      colorOnly: comparison.colorOnly,
      deviation,
    }
  }
  const requests = compareRequests(results[0].requests, results[1].requests, box.root)
  const requestsMissing = scenario.requests !== undefined && !deviationExists(scenario.requests.deviation)
  const requestsPass = !requestsMissing && (requests.equal || scenario.requests !== undefined)
  ok &&= requestsPass
  lines.push(
    `  requests: ${requests.equal ? "writes equal" : requestsPass ? "writes differ, allowed" : "writes differ"}`,
  )
  if (requestsMissing) lines.push(`    deviation file missing: ${JSON.stringify(scenario.requests?.deviation)}`)
  if (!requests.equal) {
    lines.push(...requests.writes.a.map((write) => `    - ${labels[0]} | ${write}`))
    lines.push(...requests.writes.b.map((write) => `    + ${labels[1]} | ${write}`))
  }
  if (requests.onlyA.length)
    lines.push(`    reads only ${labels[0]} sent (${requests.onlyA.length}): ${requests.onlyA.join(", ")}`)
  if (requests.onlyB.length)
    lines.push(`    reads only ${labels[1]} sent (${requests.onlyB.length}): ${requests.onlyB.join(", ")}`)
  report.requests = requests
  report.model = results.map((result) => result.model)
  await writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2) + "\n")
  console.log(`${ok ? "ok  " : "FAIL"} ${name}\n${lines.join("\n")}`)
  await rm(box.root, { recursive: true, force: true })
  return ok
}

async function runSide(box: Sandbox, side: Side, label: string, scenario: SimScenario) {
  // A fresh home for each side; `work` keeps its path so paths on screen match.
  await Promise.all(
    ["home", "tmp", "drive", "opencode-config"].map((dir) =>
      rm(path.join(box.root, dir), { recursive: true, force: true }),
    ),
  )
  await Promise.all(
    [
      box.env.XDG_CONFIG_HOME,
      box.env.XDG_DATA_HOME,
      box.env.XDG_STATE_HOME,
      box.env.XDG_CACHE_HOME,
      box.env.TMPDIR,
    ].map((dir) => mkdir(dir, { recursive: true })),
  )
  await rm(box.cwd, { recursive: true, force: true })
  await mkdir(box.cwd, { recursive: true })
  // Core downloads tree-sitter grammars on first use and caches them; a fresh home has none, so TS would show code
  // unhighlighted (or highlight it once a download lands). A copy of the user's cache matches how the TS TUI runs
  // for them, and what Rust links statically (H06-highlight-queries).
  if (
    await stat(GRAMMAR_CACHE).then(
      (info) => info.isDirectory(),
      () => false,
    )
  )
    await cp(GRAMMAR_CACHE, path.join(box.env.XDG_DATA_HOME, "opentui", "tree-sitter"), { recursive: true })
  for (const [file, contents] of Object.entries(scenario.files ?? {}))
    await Bun.write(path.join(box.cwd, file), contents)
  await Bun.write(
    path.join(box.env.XDG_CONFIG_HOME, "opencode", "cli.json"),
    // The TS CLI from source is the `local` channel, which shows the DevTools bar by default.
    JSON.stringify({
      experimental: { "new-designs": true },
      animations: false,
      debug: { devtools: false },
      ...scenario.config,
    }),
  )
  const configDir = path.join(box.root, "opencode-config")
  await Bun.write(path.join(configDir, "opencode.jsonc"), JSON.stringify(serverConfig(scenario), null, 2))
  const registry = path.join(box.root, "drive")
  // The fixed clock every side's processes share: Rust reads the variables itself, and each TS process gets the
  // preload that reads them.
  const clock: Record<string, string> = {
    OPENCODE_DRIVE_NOW: String(scenario.now ?? DEFAULT_NOW),
    OPENCODE_DRIVE_SINCE: String(Date.now()),
  }
  const start = (side: Side, args: string[]) => {
    const cmd = command(side, args)
    return side === "ts" ? [cmd[0]!, `--preload=${CLOCK}`, ...cmd.slice(1)] : cmd
  }
  const viewport = { cols: scenario.width ?? 100, rows: scenario.height ?? 30 }
  // Every endpoint asks the kernel for its port at bind time: a port checked and then bound seconds later can be taken
  // in between by another parity run (flakes-n). Each process prints the endpoint it bound, and the runner reads it
  // there. The server's own UI endpoint is unused, but the manifest schema requires it.
  await Bun.write(
    path.join(registry, "server.json"),
    JSON.stringify({ endpoints: { ui: "ws://127.0.0.1:0", backend: "ws://127.0.0.1:0" } }),
  )
  await Bun.write(
    path.join(registry, `${side}.json`),
    JSON.stringify({ endpoints: { ui: "ws://127.0.0.1:0", backend: "ws://127.0.0.1:0" }, viewport }),
  )
  const log = (file: string) => path.join(box.root, `${label}.${file}`)
  const stopped: (() => void)[] = []
  const debug: { screen?: () => Promise<Fixture>; model?: unknown; requests?: Logged[] } = {}
  try {
    const server = spawn(start("ts", ["serve", "--port", "0"]), box, log("server.stderr"), log("server.stdout"), {
      ...clock,
      OPENCODE_SIMULATE: "1",
      OPENCODE_DRIVE: "server",
      DRIVE_REGISTRY_DIR: registry,
      OPENCODE_DB: ":memory:",
      OPENCODE_CONFIG_DIR: configDir,
    })
    stopped.push(() => server.kill(9))
    const serverUrl = await waitFor(
      `${label} server`,
      async () => {
        const match = /server listening on (http:\/\/\S+)/.exec(await readText(log("server.stdout")))
        return match?.[1] ?? false
      },
      60_000,
    )
    await waitFor(
      `${label} server health`,
      () =>
        fetch(`${serverUrl}/api/health`).then(
          () => true,
          () => false,
        ),
      60_000,
    )
    const backendUrl = await waitFor(
      `${label} backend endpoint`,
      async () => {
        const match = /opencode drive backend websocket: (ws:\/\/\S+)/.exec(await readText(log("server.stderr")))
        return match?.[1] ?? false
      },
      60_000,
    )
    const model: { url: string; kind: string; reply: number | null; tools?: string[] }[] = []
    let turn = 0
    const backend = await startBackend(backendUrl, (invocation) => {
      if (isTitleRequest(invocation)) {
        model.push({ url: invocation.url, kind: "title", reply: null })
        return { items: [{ type: "textDelta", text: "Simulated session" }] }
      }
      const reply: Reply = scenario.model[turn] ?? { items: [{ type: "textDelta", text: "(no scripted reply)" }] }
      model.push({ url: invocation.url, kind: "turn", reply: turn, tools: toolNames(invocation) })
      turn++
      return reply
    })
    stopped.push(backend.close)
    debug.model = model
    const sessions = await createSessions(serverUrl, box.cwd, scenario.sessions ?? [])
    const proxy = startProxy(serverUrl)
    stopped.push(proxy.stop)
    const args = (scenario.args ?? []).map((arg) =>
      arg.startsWith("$session:") ? sessions[Number(arg.slice("$session:".length))] : arg,
    )
    const client = spawn(
      start(side, [...args, "--server", proxy.url]),
      box,
      log("client.stderr"),
      log("client.stdout"),
      {
        ...clock,
        OPENCODE_DRIVE: side,
        DRIVE_REGISTRY_DIR: registry,
        OPENCODE_DRIVE_RENDERER: "headless",
        TERM: "xterm-256color",
      },
    )
    stopped.push(() => client.kill(9))
    // Both clients print the endpoint they bound, which is the kernel's port now that the manifest asks for 0.
    const driveUrl = await waitFor(
      `${label} drive endpoint`,
      async () => {
        const match = /opencode drive ui websocket: (ws:\/\/\S+)/.exec(await readText(log("client.stderr")))
        return match?.[1] ?? false
      },
      60_000,
    )
    const drive = await connectDrive(driveUrl, label)
    stopped.push(drive.close)
    const result = async (method: string, params?: unknown) => {
      const response = await drive.call(method, params)
      if (response.error)
        throw new Error(`${label} ${method} ${JSON.stringify(params ?? {})}: ${response.error.message}`)
      return response.result
    }
    Schema.decodeUnknownSync(Handshake.Response)(
      await result("simulation.handshake", {
        client: { name: "opencode-parity", version: "1" },
        expectedRole: "ui",
        offeredVersions: [1],
        requiredCapabilities: ["ui.type", "ui.press", "ui.enter", "ui.mouse", "ui.matches", "ui.capture"],
        optionalCapabilities: [],
      }),
    )
    const until = async (needle: string) => {
      await waitFor(
        `${label} screen to show ${JSON.stringify(needle)}`,
        async () => (await result("ui.matches", { text: needle })) === true,
        WAIT,
      )
    }
    const gone = async (needle: string) => {
      await waitFor(
        `${label} screen to stop showing ${JSON.stringify(needle)}`,
        async () => (await result("ui.matches", { text: needle })) === false,
        WAIT,
      )
    }
    const capture = async () => toFixture(Schema.decodeUnknownSync(Frontend.CapturedFrame)(await result("ui.capture")))
    const captures: Record<string, Fixture> = {}
    debug.screen = capture
    debug.model = model
    debug.requests = proxy.log
    for (const step of scenario.steps) {
      console.error(`${label} ${JSON.stringify(step)}`)
      await runStep(step, { result, until, gone, capture, captures, release: backend.release, cwd: box.cwd })
    }
    if (backend.failures.length) throw new Error(`${label} backend: ${backend.failures.join("; ")}`)
    return { captures, requests: proxy.log as Logged[], model }
  } catch (error) {
    console.error(`${label}: failed; logs in ${box.root} until the run ends:`)
    for (const file of ["server.stderr", "client.stderr"])
      console.error(`--- ${file}\n${(await readText(log(file))).slice(-3000)}`)
    console.error(`--- model calls\n${JSON.stringify(debug.model)}`)
    const requests = (debug.requests ?? []).map((entry) => `${entry.status ?? "..."} ${entry.method} ${entry.path}`)
    console.error(`--- requests\n${requests.join("\n")}`)
    const screen = await debug.screen?.().catch(() => undefined)
    if (screen) console.error(`--- screen\n${text(screen)}`)
    throw error
  } finally {
    stopped.toReversed().forEach((stop) => stop())
  }
}

async function runStep(
  step: Step,
  io: {
    result: (method: string, params?: unknown) => Promise<unknown>
    until: (needle: string) => Promise<void>
    gone: (needle: string) => Promise<void>
    capture: () => Promise<Fixture>
    captures: Record<string, Fixture>
    release: (name: string) => void
    cwd: string
  },
) {
  if ("release" in step) return io.release(step.release)
  if ("touch" in step) return writeFile(path.join(io.cwd, step.touch), "")
  if ("sleep" in step) return Bun.sleep(step.sleep)
  if ("type" in step) return io.result("ui.type", { text: step.type })
  if ("press" in step)
    return io.result("ui.press", { key: step.press, ...(step.modifiers ? { modifiers: step.modifiers } : {}) })
  if ("enter" in step) return io.result("ui.enter")
  if ("arrow" in step) return io.result("ui.arrow", { direction: step.arrow })
  if ("mouse" in step) return io.result("ui.mouse", step.mouse)
  if ("resize" in step) return io.result("ui.resize", { cols: step.resize[0], rows: step.resize[1] })
  if ("until" in step && !("checkpoint" in step)) return io.until(step.until)
  if ("gone" in step) return io.gone(step.gone)
  if (!("checkpoint" in step)) return
  if (step.until) await io.until(step.until)
  // Three captures in a row with the same cells, as H.2's runner waits for a stable frame.
  const deadline = Date.now() + WAIT
  let last = await io.capture()
  let same = 1
  while (same < 3) {
    if (Date.now() > deadline) throw new Error(`checkpoint ${step.checkpoint}: the screen did not settle`)
    await Bun.sleep(150)
    const next = await io.capture()
    same = JSON.stringify(next) === JSON.stringify(last) ? same + 1 : 1
    last = next
  }
  io.captures[step.checkpoint] = applyMasks(last, [...(step.masks ?? []), SANDBOX_MASK])
}

// Creates the scenario's sessions straight on the server and runs each prompt to the end, so the client opens
// a history built by real turns. Returns the session IDs in order.
async function createSessions(server: string, directory: string, sessions: NonNullable<SimScenario["sessions"]>) {
  const headers = {
    authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
    "content-type": "application/json",
  }
  const api = async (method: string, route: string, body?: unknown) => {
    const response = await fetch(server + route, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!response.ok) throw new Error(`setup ${method} ${route}: ${response.status} ${await response.text()}`)
    return response.status === 204 ? undefined : ((await response.json()) as { data: unknown })
  }
  const ids: string[] = []
  for (const session of sessions) {
    const created = await api("POST", "/api/session", {
      ...(session.title === undefined ? {} : { title: session.title }),
      agent: "build",
      location: { directory },
      model: { id: "gpt-sim-model", providerID: "simulation" },
    })
    const id = (created?.data as { id: string }).id
    ids.push(id)
    for (const [index, text] of session.prompts.entries()) {
      await api("POST", `/api/session/${id}/prompt`, { text })
      await waitFor(
        `setup session ${id} prompt ${index} to finish`,
        async () => {
          const active = (await api("GET", "/api/session/active"))?.data as Record<string, unknown>
          if (id in active) return false
          // Newest first; a finished turn ends with an `idle` message.
          const messages = (await api("GET", `/api/session/${id}/message`))?.data as { type: string }[]
          return (
            messages.filter((message) => message.type === "user").length === index + 1 && messages[0]?.type === "idle"
          )
        },
        WAIT,
      ).catch(async (error: Error) => {
        const messages = await api("GET", `/api/session/${id}/message`)
        throw new Error(`${error.message}; messages: ${JSON.stringify(messages).slice(0, 2000)}`)
      })
    }
  }
  return ids
}

// The simulation provider of `opencode-drive`'s default config: an OpenAI-compatible provider at the default
// OpenAI URL, which the simulated network routes to the backend driver.
function serverConfig(scenario: SimScenario) {
  return {
    model: "simulation/gpt-sim-model",
    snapshots: false,
    // `full_codemode` defaults to on in the local channel (#64761), and with it a GPT model gets only `execute`
    // (#64515). The scenarios script direct `shell`, `read` and `patch` calls, so keep those tools direct.
    experimental: { full_codemode: false },
    permissions: [{ action: "*", resource: "*", effect: "allow" }, ...(scenario.permissions ?? [])],
    providers: {
      simulation: {
        name: "Simulation",
        package: "aisdk:@ai-sdk/openai-compatible",
        settings: { baseURL: "https://api.openai.com/v1" },
        request: { body: { apiKey: "sim-key" } },
        models: {
          "gpt-sim-model": {
            name: "Simulated Model",
            capabilities: { tools: true, input: ["text"], output: ["text"] },
            limit: { context: 128000, output: 16000 },
          },
        },
      },
    },
  }
}

// The title agent's call carries no tools; the session's turns always offer them.
function isTitleRequest(invocation: Invocation) {
  const body = invocation.body as { tools?: unknown[] } | null
  return !body?.tools?.length
}

// The tool names a turn offers, for the report: they tell a scenario which `toolCall` names exist.
function toolNames(invocation: Invocation) {
  const body = invocation.body as { tools?: { function?: { name?: string } }[] } | null
  return (body?.tools ?? []).flatMap((tool) => (tool.function?.name ? [tool.function.name] : []))
}

function spawn(cmd: string[], box: Sandbox, stderr: string, stdout: string, env: Record<string, string>) {
  const child = Bun.spawn(cmd, {
    cwd: box.cwd,
    env: { ...box.env, ...env },
    stdin: "ignore",
    stdout: Bun.file(stdout),
    stderr: Bun.file(stderr),
  })
  children.add(child)
  child.exited.then(() => children.delete(child))
  return child
}

async function waitFor<T>(what: string, check: () => Promise<T | false | undefined>, ms: number): Promise<T> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const value = await check()
    if (value) return value
    await Bun.sleep(100)
  }
  throw new Error(`timed out waiting for ${what}`)
}

function readText(file: string) {
  return Bun.file(file)
    .text()
    .catch(() => "")
}

function deviationExists(file: string) {
  return Bun.file(path.join(parityRoot, "deviations", `${file}.md`)).size > 0
}

function indent(value: string, spaces: number) {
  return value
    .split("\n")
    .map((line) => " ".repeat(spaces) + line)
    .join("\n")
}
