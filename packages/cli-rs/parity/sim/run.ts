// P-TUI runner (docs/H.5.md):
//
//   bun run --cwd packages/cli-rs parity:sim [--sides ts,rs] [parity/scenarios/<step>/<name>.sim.ts ...]
//
// Each side runs alone against its own simulated TS server, backend driver, and recording proxy, in a sandbox that
// never touches the user's config, state, or service. Every process a side starts is killed when the side ends,
// when the run fails, and when the runner exits.
import { mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { Schema } from "effect"
import { Frontend, Handshake } from "@opencode/protocol/simulation"
import { applyMasks } from "../lib/app"
import { writeFixture, type Fixture } from "../lib/cells"
import { buildRust, command, parseSides, parityRoot, sandbox, type Sandbox, type Side } from "../cli/client"
import { startBackend, type Invocation, type Reply } from "./backend"
import { compareFixtures, compareRequests, text, toFixture } from "./compare"
import { connectDrive } from "./drive"
import { startProxy, type Logged } from "./proxy"
import type { SimScenario, Step } from "./scenario"

// The whole run, after which the runner stops every process and fails. The caller's `timeout -s KILL` should be
// longer, so this cleanup runs first.
const RUN_DEADLINE = Number(process.env.PARITY_SIM_DEADLINE ?? 240_000)
const WAIT = 30_000
const password = "sim-parity"

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
const files = argv.filter((arg, index) => !arg.startsWith("--") && index !== sidesFlag + 1)
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
  const out = path.join(parityRoot, "fixtures", name.replace(/\//g, path.sep))
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
    const missing = deviation.filter((file) => !Bun.file(path.join(parityRoot, "deviations", `${file}.md`)).size)
    const pass = missing.length === 0 && (comparison.equal || deviation.length > 0)
    ok &&= pass
    const summary = comparison.equal
      ? comparison.report
      : `${comparison.report.split("\n")[0]}; ${pass ? `differs, allowed by ${JSON.stringify(deviation)}` : "differs"}`
    lines.push(`  checkpoint ${checkpoint.checkpoint}: ${summary}`)
    if (missing.length) lines.push(`    deviation files missing: ${JSON.stringify(missing)}`)
    if (!pass || process.env.PARITY_VERBOSE) lines.push(indent(comparison.report, 4))
    report[checkpoint.checkpoint] = { equal: comparison.equal, differences: comparison.differences, deviation }
  }
  const requests = compareRequests(results[0].requests, results[1].requests, box.root)
  const requestsPass = requests.equal || scenario.requests !== undefined
  ok &&= requestsPass
  lines.push(
    `  requests: ${requests.equal ? "writes equal" : requestsPass ? "writes differ, allowed" : "writes differ"}`,
  )
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
  for (const [file, contents] of Object.entries(scenario.files ?? {}))
    await Bun.write(path.join(box.cwd, file), contents)
  await Bun.write(
    path.join(box.env.XDG_CONFIG_HOME, "opencode", "cli.json"),
    // The TS CLI from source is the `local` channel, which shows the DevTools bar by default.
    JSON.stringify({ experimental: { "new-designs": true }, animations: false, debug: { devtools: false } }),
  )
  const configDir = path.join(box.root, "opencode-config")
  await Bun.write(path.join(configDir, "opencode.jsonc"), JSON.stringify(serverConfig(scenario), null, 2))
  const registry = path.join(box.root, "drive")
  const [serverPort, backendPort, serverUiPort, uiPort] = await Promise.all([0, 1, 2, 3].map(freePort))
  const backendUrl = `ws://127.0.0.1:${backendPort}`
  const viewport = { cols: scenario.width ?? 100, rows: scenario.height ?? 30 }
  await Bun.write(
    path.join(registry, "server.json"),
    JSON.stringify({ endpoints: { ui: `ws://127.0.0.1:${serverUiPort}`, backend: backendUrl } }),
  )
  await Bun.write(
    path.join(registry, `${side}.json`),
    JSON.stringify({ endpoints: { ui: `ws://127.0.0.1:${uiPort}`, backend: backendUrl }, viewport }),
  )
  const log = (file: string) => path.join(box.root, `${label}.${file}`)
  const stopped: (() => void)[] = []
  const debug: { screen?: () => Promise<Fixture>; model?: unknown; requests?: Logged[] } = {}
  try {
    const server = spawn(command("ts", ["serve", "--port", String(serverPort)]), box, log("server.stderr"), {
      OPENCODE_SIMULATE: "1",
      OPENCODE_DRIVE: "server",
      DRIVE_REGISTRY_DIR: registry,
      OPENCODE_DB: ":memory:",
      OPENCODE_CONFIG_DIR: configDir,
    })
    stopped.push(() => server.kill(9))
    const serverUrl = `http://127.0.0.1:${serverPort}`
    await waitFor(
      `${label} server`,
      () =>
        fetch(`${serverUrl}/api/health`).then(
          () => true,
          () => false,
        ),
      60_000,
    )
    await waitFor(
      `${label} backend endpoint`,
      async () => (await readText(log("server.stderr"))).includes("opencode drive backend websocket:"),
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
    const proxy = startProxy(serverUrl)
    stopped.push(proxy.stop)
    const client = spawn(command(side, ["--server", proxy.url]), box, log("client.stderr"), {
      OPENCODE_DRIVE: side,
      DRIVE_REGISTRY_DIR: registry,
      OPENCODE_DRIVE_RENDERER: "headless",
      TERM: "xterm-256color",
    })
    stopped.push(() => client.kill(9))
    await waitFor(
      `${label} drive endpoint`,
      async () => (await readText(log("client.stderr"))).includes("opencode drive ui websocket:"),
      60_000,
    )
    const drive = await connectDrive(`ws://127.0.0.1:${uiPort}`, label)
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
    const until = (needle: string) =>
      waitFor(
        `${label} screen to show ${JSON.stringify(needle)}`,
        async () => (await result("ui.matches", { text: needle })) === true,
        WAIT,
      )
    const capture = async () => toFixture(Schema.decodeUnknownSync(Frontend.CapturedFrame)(await result("ui.capture")))
    const captures: Record<string, Fixture> = {}
    debug.screen = capture
    debug.model = model
    debug.requests = proxy.log
    for (const step of scenario.steps) {
      console.error(`${label} ${JSON.stringify(step)}`)
      await runStep(step, { result, until, capture, captures })
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
    capture: () => Promise<Fixture>
    captures: Record<string, Fixture>
  },
) {
  if ("type" in step) return io.result("ui.type", { text: step.type })
  if ("press" in step)
    return io.result("ui.press", { key: step.press, ...(step.modifiers ? { modifiers: step.modifiers } : {}) })
  if ("enter" in step) return io.result("ui.enter")
  if ("arrow" in step) return io.result("ui.arrow", { direction: step.arrow })
  if ("mouse" in step) return io.result("ui.mouse", step.mouse)
  if ("resize" in step) return io.result("ui.resize", { cols: step.resize[0], rows: step.resize[1] })
  if ("until" in step && !("checkpoint" in step)) return io.until(step.until)
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
  io.captures[step.checkpoint] = applyMasks(last, step.masks ?? [])
}

// The simulation provider of `opencode-drive`'s default config: an OpenAI-compatible provider at the default
// OpenAI URL, which the simulated network routes to the backend driver.
function serverConfig(scenario: SimScenario) {
  return {
    model: "simulation/gpt-sim-model",
    snapshots: false,
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

function spawn(cmd: string[], box: Sandbox, stderr: string, env: Record<string, string>) {
  const child = Bun.spawn(cmd, {
    cwd: box.cwd,
    // Bun's os.homedir() ignores HOME, so without OPENCODE_TEST_HOME the server watches the user's skill folders.
    env: { ...box.env, OPENCODE_TEST_HOME: box.env.HOME, ...env },
    stdin: "ignore",
    stdout: "ignore",
    stderr: Bun.file(stderr),
  })
  children.add(child)
  child.exited.then(() => children.delete(child))
  return child
}

async function waitFor(what: string, check: () => Promise<boolean>, ms: number) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (await check()) return
    await Bun.sleep(100)
  }
  throw new Error(`timed out waiting for ${what}`)
}

function readText(file: string) {
  return Bun.file(file)
    .text()
    .catch(() => "")
}

async function freePort(_: number) {
  const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } })
  const port = listener.port
  listener.stop(true)
  return port
}

function indent(value: string, spaces: number) {
  return value
    .split("\n")
    .map((line) => " ".repeat(spaces) + line)
    .join("\n")
}
