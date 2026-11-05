// H.4 proof: sends the same simulation UI requests to the TS and the Rust `OPENCODE_DRIVE` endpoints, checks
// every response against the protocol schema (`packages/protocol/src/simulation.ts`), and compares the captures.
//
//   bun run parity/scenarios/H.4/drive.ts
//
// One TS server runs in simulation mode (`OPENCODE_SIMULATE=1`) in a fresh sandbox home, never the user's service.
// Each client runs headless against it with its own drive manifest. Captures go to `parity/fixtures/H.4/`.
// Build the Rust binary first (`cargo build -p opencode-cli --bin opencode-rs`) or set OPENCODE_RS_BIN.

import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { Schema } from "effect"
import { Frontend, Handshake, JsonRpc } from "@opencode/protocol/simulation"
import { command, parityRoot, sandbox, type Side } from "../../cli/client"

const viewport = { cols: 100, rows: 30 }
const password = "drive-parity"

// Each step: the request, the schema its result must decode with, and the capture name to keep.
type Step = { method: string; params?: unknown; result?: Schema.Top; capture?: string; until?: string }
const steps: Step[] = [
  {
    method: "simulation.handshake",
    params: {
      client: { name: "drive-parity", version: "1" },
      expectedRole: "ui",
      offeredVersions: [1],
      requiredCapabilities: ["ui.type", "ui.capture"],
      optionalCapabilities: [],
    },
    result: Handshake.Response,
  },
  { method: "ui.matches", params: { text: "ctrl+p commands" }, result: Frontend.Matches, until: "ctrl+p commands" },
  { method: "ui.capture", result: Frontend.CapturedFrame, capture: "home" },
  { method: "ui.enter", result: Frontend.State },
  { method: "ui.type", params: { text: "hello drive" }, result: Frontend.State },
  { method: "ui.matches", params: { text: "hello drive" }, result: Frontend.Matches },
  { method: "ui.capture", result: Frontend.CapturedFrame, capture: "typed" },
  { method: "ui.press", params: { key: "backspace" }, result: Frontend.State },
  { method: "ui.press", params: { key: "a", modifiers: { ctrl: true } }, result: Frontend.State },
  { method: "ui.arrow", params: { direction: "right" }, result: Frontend.State },
  { method: "ui.mouse", params: { action: "move", x: 10, y: 5 }, result: Frontend.State },
  { method: "ui.mouse", params: { action: "scroll", x: 10, y: 5, direction: "down" }, result: Frontend.State },
  { method: "ui.mouse", params: { action: "move", x: 100, y: 5 } },
  { method: "ui.resize", params: { cols: 90, rows: 28 }, result: Frontend.State },
  { method: "ui.capture", result: Frontend.CapturedFrame, capture: "edited-resized" },
  { method: "ui.state", result: Frontend.State },
]

const box = await sandbox({ OPENCODE_PASSWORD: password })
await mkdir(path.join(box.env.XDG_CONFIG_HOME, "opencode"), { recursive: true })
await writeFile(
  path.join(box.env.XDG_CONFIG_HOME, "opencode", "cli.json"),
  JSON.stringify({ experimental: { "new-designs": true }, animations: false }),
)
const ports = await Promise.all([0, 1, 2].map(freePort))
const server = `http://127.0.0.1:${ports[0]}`
const serve = Bun.spawn(command("ts", ["serve", "--port", String(ports[0])]), {
  cwd: box.cwd,
  env: { ...box.env, OPENCODE_SIMULATE: "1" },
  stdout: "ignore",
  stderr: Bun.file(path.join(box.root, "server.log")),
})
const children = [serve]
process.on("exit", () => children.forEach((child) => child.kill()))

const report: Record<string, unknown> = {}
try {
  await waitForServer(server)
  const results = {} as Record<Side, Awaited<ReturnType<typeof drive>>>
  for (const [index, side] of (["ts", "rs"] as const).entries()) results[side] = await drive(side, ports[index + 1])
  const out = path.join(parityRoot, "fixtures", "H.4")
  await mkdir(out, { recursive: true })
  for (const side of ["ts", "rs"] as const)
    for (const [name, frame] of Object.entries(results[side].captures))
      await writeFile(path.join(out, `${name}.${side}.txt`), text(frame) + "\n")
  for (const name of Object.keys(results.ts.captures)) {
    const ts = results.ts.captures[name]
    const rs = results.rs.captures[name]
    report[name] = compare(ts, rs)
  }
  report.responses = steps.map((step, index) => ({
    method: step.method,
    ts: results.ts.outcomes[index],
    rs: results.rs.outcomes[index],
  }))
  await writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2) + "\n")
  console.log(JSON.stringify(report, null, 2))
} finally {
  children.forEach((child) => child.kill())
}

async function drive(side: Side, port: number) {
  const registry = path.join(box.root, `drive-${side}`)
  await mkdir(registry, { recursive: true })
  await writeFile(
    path.join(registry, "parity.json"),
    JSON.stringify({
      endpoints: { ui: `ws://127.0.0.1:${port}`, backend: `ws://127.0.0.1:${port + 1000}` },
      viewport,
    }),
  )
  const client = Bun.spawn(command(side, ["--server", server]), {
    cwd: box.cwd,
    env: {
      ...box.env,
      OPENCODE_DRIVE: "parity",
      DRIVE_REGISTRY_DIR: registry,
      OPENCODE_DRIVE_RENDERER: "headless",
      TERM: "xterm-256color",
    },
    stdin: "ignore",
    stdout: Bun.file(path.join(box.root, `${side}.stdout`)),
    stderr: Bun.file(path.join(box.root, `${side}.stderr`)),
  })
  children.push(client)
  await waitForLine(path.join(box.root, `${side}.stderr`), "opencode drive ui websocket:")
  const socket = new WebSocket(`ws://127.0.0.1:${port}`)
  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = reject
  })
  const pending = new Map<number, (value: JsonRpc.Response) => void>()
  socket.onmessage = (event) => {
    const response = Schema.decodeUnknownSync(JsonRpc.Response)(JSON.parse(String(event.data)))
    pending.get(Number(response.id))?.(response)
  }
  let id = 0
  const call = (method: string, params?: unknown) =>
    new Promise<JsonRpc.Response>((resolve) => {
      id++
      pending.set(id, resolve)
      socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) }))
    })
  const captures: Record<string, Frontend.CapturedFrame> = {}
  const outcomes: unknown[] = []
  for (const step of steps) {
    const deadline = Date.now() + 30_000
    let response = await call(step.method, step.params)
    while (step.until && response.result !== true && Date.now() < deadline) {
      await Bun.sleep(50)
      response = await call(step.method, step.params)
    }
    if (response.error) {
      outcomes.push({ error: response.error.message })
      continue
    }
    if (!step.result) throw new Error(`${side} ${step.method}: expected an error, got a result`)
    const decoded = Schema.decodeUnknownSync(step.result)(response.result)
    if (step.capture) captures[step.capture] = decoded as Frontend.CapturedFrame
    outcomes.push(
      step.method === "ui.capture"
        ? "frame"
        : step.method === "simulation.handshake"
          ? { capabilities: (decoded as Handshake.Response).capabilities.length }
          : decoded,
    )
  }
  socket.close()
  client.kill()
  await client.exited
  return { captures, outcomes }
}

function text(frame: Frontend.CapturedFrame) {
  return frame.lines.map((line) => line.spans.map((span) => span.text).join("").trimEnd()).join("\n")
}

// Cells that differ in text, colors, or attributes, and the rows with a text difference.
function compare(ts: Frontend.CapturedFrame, rs: Frontend.CapturedFrame) {
  const cells = (frame: Frontend.CapturedFrame) =>
    frame.lines.map((line) =>
      line.spans.flatMap((span) => {
        const chars = [...span.text]
        return Array.from({ length: span.width }, (_, index) => ({
          char: chars[index] ?? "",
          style: JSON.stringify([span.fg, span.bg, span.attributes]),
        }))
      }),
    )
  const a = cells(ts)
  const b = cells(rs)
  let textCells = 0
  let styleCells = 0
  a.forEach((row, y) =>
    row.forEach((cell, x) => {
      const other = b[y]?.[x]
      if (other?.char !== cell.char) textCells++
      if (other?.style !== cell.style) styleCells++
    }),
  )
  const tsRows = text(ts).split("\n")
  const rsRows = text(rs).split("\n")
  const rows = tsRows.flatMap((row, y) => (row === rsRows[y] ? [] : [{ y, ts: row, rs: rsRows[y] }]))
  return { size: [ts.cols, ts.rows, rs.cols, rs.rows], textCells, styleCells, rows }
}

async function freePort(_: number) {
  const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } })
  const port = listener.port
  listener.stop(true)
  return port
}

async function waitForServer(url: string) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const ok = await fetch(`${url}/api/health`).then(
      () => true,
      () => false,
    )
    if (ok) return
    await Bun.sleep(200)
  }
  throw new Error("the simulated server did not start")
}

async function waitForLine(file: string, prefix: string) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const text = await Bun.file(file).text().catch(() => "")
    if (text.includes(prefix)) return
    await Bun.sleep(100)
  }
  throw new Error(`no ${prefix} line in ${file}`)
}
