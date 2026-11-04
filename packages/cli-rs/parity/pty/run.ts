// P-PTY (plan 7.1): runs one command with the TS CLI and with `opencode-rs` under a fixed-size
// pseudo-terminal, renders the output through OpenTUI's embedded terminal (which also answers the
// program's terminal queries), and compares the OSC log, the screens at checkpoints, and the exit.
//
//   bun run parity/pty/run.ts [--sides ts,rs] [scenario.pty.ts ...]
//
// Without files it runs every `parity/scenarios/**/*.pty.ts`. Sides run one after the other. Each
// side's record goes to `$TMPDIR/opencode-parity/pty/<name>.<n>-<side>.json`.

import { parseArgs } from "node:util"
import { Glob } from "bun"
import path from "node:path"
import { tmpdir } from "node:os"
import { rm } from "node:fs/promises"
import { EmbeddedTerminalRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { startFakeServer, type FakeServer, type Options } from "../lib/fake-server"
import {
  buildRust,
  command,
  nameOf,
  normalize,
  parityRoot,
  parseSides,
  sandbox,
  withServer,
  type Side,
} from "../cli/client"
import { requestLog } from "../cli/run"
import { diffRecords } from "../cli/diff"

export type OscKind = "title" | "progress" | "status" | "clipboard" | "notify" | "other"

export type PtyStep = {
  // Written to the terminal as is, for example "\x03" for Ctrl+C, or "\x1b[O" to report a focus loss.
  keys?: string
  // Pushed to the `fallback: "tui"` event stream after the keys.
  emit?: Parameters<FakeServer["emit"]>[0][]
  // Waits until an OSC sequence or the screen matches (a string matches as a substring).
  until?: { osc?: string | RegExp; screen?: string | RegExp }
  // Waits until the screen has not changed for this long.
  settle?: number
  // Records the screen under this name.
  checkpoint?: string
  timeout?: number
}

export type PtyCase = {
  args: string[]
  server?: Options
  env?: Record<string, string>
  cols?: number
  rows?: number
  steps: PtyStep[]
  // The OSC kinds the comparison keeps. Terminal queries (colors, pointer shape) are `other`.
  osc?: OscKind[]
  // Compare the OSC log one kind at a time, in the order of `osc`, when the order between kinds is not fixed.
  oscByKind?: boolean
  // Wait for the program to exit after the last step and record the code; otherwise it is killed.
  exits?: boolean
  // Plan 7.5: line masks for checkpoints. Each match becomes `<masked>`; say why in `reason`.
  masks?: { pattern: RegExp; reason: string }[]
  // Compare the request log too.
  requests?: boolean
  tsOnly?: boolean
}

export function definePty(value: PtyCase) {
  return value
}

export async function runPty(side: Side, value: PtyCase) {
  const cols = value.cols ?? 100
  const rows = value.rows ?? 30
  const box = await sandbox({ TERM: "xterm-256color", COLORTERM: "truecolor", ...value.env })
  const server = value.server ? await startFakeServer(value.server) : undefined
  const setup = await createTestRenderer({ width: cols, height: rows })
  const decoder = new TextDecoder()
  const output = { text: "" }
  const terminal = new EmbeddedTerminalRenderable(setup.renderer, {
    cols,
    rows,
    onData: (data) => proc.terminal?.write(data),
  })
  setup.renderer.root.add(terminal)
  const proc = Bun.spawn(command(side, withServer(value.args, server?.url)), {
    cwd: box.cwd,
    env: box.env,
    terminal: {
      cols,
      rows,
      data(_terminal, data) {
        output.text += decoder.decode(data, { stream: true })
        terminal.write(data)
      },
    },
  })
  const exited = proc.exited.then((code) => ({ code }))
  const screen = async () => {
    await setup.renderOnce()
    return terminal.screen().lines
  }
  const checkpoints: Record<string, string[]> = {}
  const failures: string[] = []
  for (const step of value.steps) {
    if (step.keys !== undefined) proc.terminal?.write(step.keys)
    step.emit?.forEach((event) => server?.emit(event))
    const failure = await waitFor(step, { screen, osc: () => oscLog(output.text), exited })
    if (failure) {
      failures.push(failure)
      break
    }
    if (step.checkpoint) checkpoints[step.checkpoint] = await screen()
  }
  const exit =
    value.exits && !failures.length ? await Promise.race([exited, Bun.sleep(10_000).then(() => undefined)]) : undefined
  if (exit === undefined) proc.kill("SIGKILL")
  await proc.exited
  proc.terminal?.close()
  setup.renderer.destroy()
  await server?.stop()
  await rm(box.root, { recursive: true, force: true })
  const context = { server: server?.url, root: box.root }
  const kinds = value.osc ?? ["title", "progress", "clipboard", "notify"]
  return {
    ...(failures.length ? { failures } : {}),
    exit: value.exits ? (exit?.code ?? "timeout") : "killed",
    osc: oscLog(output.text)
      .filter((entry) => kinds.includes(entry.kind))
      .toSorted((a, b) => (value.oscByKind ? kinds.indexOf(a.kind) - kinds.indexOf(b.kind) : 0))
      .map((entry) => normalize(`${entry.kind} ${entry.data}`, context)),
    checkpoints: Object.fromEntries(
      Object.entries(checkpoints).map(([name, lines]) => [
        name,
        lines.map((line) =>
          (value.masks ?? []).reduce(
            (current, mask) => current.replace(mask.pattern, "<masked>"),
            normalize(line, context),
          ),
        ),
      ]),
    ),
    ...(value.requests ? { requests: requestLog(server?.requests ?? [], context) } : {}),
  }
}

// OSC sequences in the order the program wrote them: ESC ] … terminated by BEL or ESC \.
export function oscLog(text: string) {
  return [...text.matchAll(/\x1b\]([^\x07\x1b]*)(?:\x07|\x1b\\)/g)].map((match) => ({
    kind: oscKind(match[1]),
    data: match[1],
  }))
}

function oscKind(data: string): OscKind {
  const code = data.split(";")[0]
  if (["0", "1", "2"].includes(code)) return "title"
  if (data.startsWith("9;4;")) return "progress"
  // `7501;?` asks whether the terminal has the program status protocol.
  if (code === "7501") return data === "7501;?" ? "other" : "status"
  if (code === "52") return "clipboard"
  // `99;…:p=?;` asks the terminal which kitty notification features it has.
  if (code === "99" && /[:;]p=\?/.test(data)) return "other"
  if (["9", "99", "777"].includes(code)) return "notify"
  return "other"
}

type Probe = {
  screen: () => Promise<string[]>
  osc: () => ReturnType<typeof oscLog>
  exited: Promise<{ code: number }>
}

async function waitFor(step: PtyStep, probe: Probe) {
  const deadline = Date.now() + (step.timeout ?? 15_000)
  const done = { exited: false }
  probe.exited.then(() => (done.exited = true))
  const state = { last: "", since: Date.now() }
  while (Date.now() < deadline) {
    const lines = await probe.screen()
    const text = lines.join("\n")
    if (text !== state.last) Object.assign(state, { last: text, since: Date.now() })
    const osc = step.until?.osc
    const oscOk =
      osc === undefined ||
      probe.osc().some((entry) => (typeof osc === "string" ? entry.data.includes(osc) : osc.test(entry.data)))
    const want = step.until?.screen
    const screenOk = want === undefined || (typeof want === "string" ? text.includes(want) : want.test(text))
    const settled = step.settle === undefined || Date.now() - state.since >= step.settle
    if (oscOk && screenOk && settled) return
    if (done.exited && !(oscOk && screenOk)) return `exited while waiting for ${describe(step)}\n${text}`
    await Bun.sleep(25)
  }
  return `timed out waiting for ${describe(step)}\n${state.last}`
}

function describe(step: PtyStep) {
  return JSON.stringify({ ...step.until, settle: step.settle }, (_key, value) =>
    value instanceof RegExp ? String(value) : value,
  )
}

if (import.meta.main) {
  const parsed = parseArgs({ args: Bun.argv.slice(2), options: { sides: { type: "string" } }, allowPositionals: true })
  const sides = parseSides(parsed.values.sides)
  const files = parsed.positionals.length
    ? parsed.positionals.map((file) => path.resolve(file))
    : [...new Glob("scenarios/**/*.pty.ts").scanSync({ cwd: parityRoot, absolute: true })].toSorted()
  await buildRust(sides)
  const failed = { any: false }
  for (const file of files) {
    const value: PtyCase = (await import(file)).default
    const name = nameOf(file)
    if (value.tsOnly && sides.includes("rs")) {
      console.log(`skip ${name} (tsOnly)`)
      continue
    }
    const records = []
    for (const side of sides) records.push(await runPty(side, value))
    await Promise.all(
      records.map((record, index) =>
        Bun.write(
          path.join(tmpdir(), "opencode-parity/pty", `${name}.${index}-${sides[index]}.json`),
          JSON.stringify(record, null, 2) + "\n",
        ),
      ),
    )
    const report = diffRecords(records[0], records[1], sides)
    const broken = records.some((record) => record.failures)
    if (report || broken) failed.any = true
    console.log(
      report || broken
        ? `FAIL ${name}\n${report || records.flatMap((record) => record.failures ?? []).join("\n")}`
        : `ok   ${name}`,
    )
  }
  // The renderers keep timers; exit explicitly.
  process.exit(failed.any ? 1 : 0)
}
