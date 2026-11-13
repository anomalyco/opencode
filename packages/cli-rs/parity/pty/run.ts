// P-PTY (plan 7.1): runs one command with the TS CLI and with `opencode-native` under a fixed-size
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
import { existsSync } from "node:fs"
import { EmbeddedTerminalRenderable, TextAttributes, type CapturedLine } from "@opentui/core"
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
  // With `checkpoint`: a `parity/deviations/<file>.md` that lets the checkpoint and its `:cursor`, `:keyboard` and
  // `:scrollback` records differ between the sides in at most `lines` lines.
  deviation?: { file: string; lines: number }
  // Records each row's background runs under this name (see `backgrounds`).
  backgrounds?: string
  // With `checkpoint`, also records each row's text attribute runs as `<name>:attributes` (see `attributes`).
  attributes?: boolean
  // With `checkpoint`, also records this many scrollback rows above the screen as `<name>:scrollback`.
  scrollback?: number
  // Resizes the pseudo-terminal and the emulator before the keys.
  resize?: { cols: number; rows: number }
  timeout?: number
}

export type PtyCase = {
  args: string[]
  // Runs this program on each side instead of the CLI (`args` is then unused); `server` is the fake server's URL.
  command?: (side: Side, server: string | undefined) => string[]
  server?: Options
  env?: Record<string, string>
  cols?: number
  rows?: number
  // The terminal's colors, as `#rrggbb`: the harness answers OSC 10, 11 and 4 queries with them instead of the
  // emulator, whose answers are fixed. `colors` are slots 0-15; the others answer xterm's.
  palette?: { foreground: string; background: string; colors: string[] }
  steps: PtyStep[]
  // The OSC kinds the comparison keeps. Terminal queries (colors, pointer shape) are `other`.
  osc?: OscKind[]
  // Compare the OSC log one kind at a time, in the order of `osc`, when the order between kinds is not fixed.
  oscByKind?: boolean
  // Wait for the program to exit after the last step and record the code; otherwise it is killed.
  exits?: boolean
  // Plan 7.5: line masks for checkpoints. Each match becomes `<masked>`; say why in `reason`.
  masks?: { pattern: RegExp; reason: string }[]
  // Compare the Kitty keyboard sequences the program writes too (`keyboardLog`): all of them, and those written
  // up to each checkpoint as `<name>:keyboard`.
  keyboard?: boolean
  // Record the terminal cursor at each checkpoint too, as `<name>:cursor` (`x,y`, 0-based, or `hidden`).
  cursor?: boolean
  // Written to the emulator before the program starts, as a shell's earlier output.
  preface?: string
  // The emulator stands in for kitty 0.40: it draws OSC 66 text-sizing sequences at their size, which moves the
  // cursor as kitty does, and names itself `kitty(0.40.1)` in its XTVERSION reply.
  terminal?: "kitty"
  // Compare the request log too; `"writes"` leaves the reads out, for screens whose reads belong to later steps.
  requests?: boolean | "writes"
  tsOnly?: boolean
  // As in P-CLI: writes files into the sandbox before the command runs.
  setup?: (root: string, server: string | undefined) => Promise<void>
}

export function definePty(value: PtyCase) {
  return value
}

export async function runPty(side: Side, value: PtyCase) {
  const cols = value.cols ?? 100
  const rows = value.rows ?? 30
  const box = await sandbox({ TERM: "xterm-256color", COLORTERM: "truecolor", ...value.env })
  const server = value.server ? await startFakeServer(value.server) : undefined
  await value.setup?.(box.root, server?.url)
  // Large enough for any `resize` step.
  const setup = await createTestRenderer({ width: 300, height: 120 })
  const decoder = new TextDecoder()
  const output = { text: "" }
  const terminal = new EmbeddedTerminalRenderable(setup.renderer, {
    cols,
    rows,
    onData: (data) => proc.terminal?.write(value.terminal === "kitty" ? kittyReplies(data) : data),
  })
  setup.renderer.root.add(terminal)
  // The emulator draws palette slots in the terminal's colors; its default background stays its own, so
  // `backgrounds` can tell it from an explicit color.
  if (value.palette) terminal.write(value.palette.colors.map((color, index) => `\x1b]4;${index};${color}\x07`).join(""))
  if (value.preface) terminal.write(value.preface)
  const closed = Promise.withResolvers<void>()
  const proc = Bun.spawn(value.command?.(side, server?.url) ?? command(side, withServer(value.args, server?.url)), {
    cwd: box.cwd,
    env: box.env,
    terminal: {
      cols,
      rows,
      data(_terminal, data) {
        const text = decoder.decode(data, { stream: true })
        output.text += text
        if (!value.palette && !value.terminal) return terminal.write(data)
        const drawn = value.terminal === "kitty" ? drawTextSizing(text) : text
        if (!value.palette) return terminal.write(drawn)
        const palette = value.palette
        terminal.write(
          drawn.replace(/\x1b\]((?:10|11|4);[^\x07\x1b]*\?)(\x07|\x1b\\)/g, (_match, query: string, end: string) => {
            proc.terminal?.write(colorReplies(query, palette, end))
            return ""
          }),
        )
      },
      exit: () => closed.resolve(),
    },
  })
  // The program's last writes can still sit in the pseudo-terminal when it exits; it has exited for the
  // steps once they are read too, when the stream ends.
  const exited = Promise.all([proc.exited, closed.promise]).then(([code]) => ({ code }))
  const screen = async () => {
    await setup.renderOnce()
    return terminal.screen().lines
  }
  // The emulator's scrollback: scroll up, read the screen, scroll back down. `screen()` shows only the viewport,
  // and the scroll command is not in the renderable's public API.
  const native = terminal as unknown as {
    lib: { contextEmbeddedTerminalScroll(context: unknown, handle: unknown, delta: number): void }
    handle: { context: unknown }
  }
  const back = async (count: number) => {
    native.lib.contextEmbeddedTerminalScroll(native.handle.context, native.handle, -count)
    terminal.invalidate()
    const lines = await screen()
    native.lib.contextEmbeddedTerminalScroll(native.handle.context, native.handle, count)
    terminal.invalidate()
    await screen()
    return lines
  }
  const checkpoints: Record<string, string[]> = {}
  const failures: string[] = []
  for (const step of value.steps) {
    if (step.resize) {
      proc.terminal?.resize(step.resize.cols, step.resize.rows)
      terminal.width = step.resize.cols
      terminal.height = step.resize.rows
    }
    if (step.keys !== undefined) proc.terminal?.write(step.keys)
    step.emit?.forEach((event) => server?.emit(event))
    const failure = await waitFor(step, { screen, osc: () => oscLog(output.text), exited })
    if (failure) {
      failures.push(failure)
      break
    }
    if (step.checkpoint) checkpoints[step.checkpoint] = await screen()
    if (step.checkpoint && value.keyboard) checkpoints[`${step.checkpoint}:keyboard`] = keyboardLog(output.text)
    if (step.checkpoint && value.cursor) {
      const cursor = terminal.screen().cursor
      checkpoints[`${step.checkpoint}:cursor`] = [cursor.visible ? `${cursor.x},${cursor.y}` : "hidden"]
    }
    if (step.checkpoint && step.attributes) {
      await setup.renderOnce()
      checkpoints[`${step.checkpoint}:attributes`] = attributes(setup.captureSpans().lines.slice(0, terminal.height))
    }
    if (step.backgrounds) {
      await setup.renderOnce()
      checkpoints[step.backgrounds] = backgrounds(setup.captureSpans().lines.slice(0, terminal.height), terminal.width)
    }
    if (step.checkpoint && step.scrollback) checkpoints[`${step.checkpoint}:scrollback`] = await back(step.scrollback)
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
    ...(value.keyboard ? { keyboard: keyboardLog(output.text) } : {}),
    ...(value.requests === "writes"
      ? { requests: { writes: requestLog(server?.requests ?? [], context).writes } }
      : value.requests
        ? { requests: requestLog(server?.requests ?? [], context) }
        : {}),
  }
}

// The right record with each checkpoint a deviation allows taken from the left one, and a note per deviation. A
// deviation whose file is missing, or whose checkpoint differs in more lines than it allows, is left to fail.
function allowDeviations(value: PtyCase, left: Record<string, unknown>, right: Record<string, unknown>) {
  const notes: string[] = []
  const ours = left.checkpoints as Record<string, string[]>
  const theirs = { ...(right.checkpoints as Record<string, string[]>) }
  for (const step of value.steps) {
    if (!step.checkpoint || !step.deviation) continue
    const keys = Object.keys(ours).filter((key) => key === step.checkpoint || key.startsWith(`${step.checkpoint}:`))
    const differing = keys.reduce((count, key) => {
      const a = ours[key] ?? []
      const b = theirs[key] ?? []
      return count + Array.from({ length: Math.max(a.length, b.length) }, (_, index) => a[index] !== b[index]).filter(Boolean).length
    }, 0)
    const file = step.deviation.file
    if (!existsSync(path.join(parityRoot, "deviations", `${file}.md`))) {
      notes.push(`${step.checkpoint}: deviation file ${file}.md is missing`)
      continue
    }
    if (differing === 0) {
      notes.push(`${step.checkpoint}: equal; remove the deviation ${file}`)
      continue
    }
    if (differing > step.deviation.lines) {
      notes.push(`${step.checkpoint}: ${differing} lines differ, beyond the ${step.deviation.lines} ${file} allows`)
      continue
    }
    notes.push(`${step.checkpoint}: ${differing} lines differ, allowed by ${file}`)
    keys.forEach((key) => (theirs[key] = ours[key]))
  }
  return [{ ...right, checkpoints: theirs }, notes] as const
}

// OSC sequences in the order the program wrote them: ESC ] … terminated by BEL or ESC \.
export function oscLog(text: string) {
  return [...text.matchAll(/\x1b\]([^\x07\x1b]*)(?:\x07|\x1b\\)/g)].map((match) => ({
    kind: oscKind(match[1]),
    data: match[1],
  }))
}

// The Kitty keyboard protocol sequences in the order the program wrote them: a query (`CSI ? u`), a push
// (`CSI > flags u`), a pop (`CSI < count u`) or a set (`CSI = flags ; mode u`).
export function keyboardLog(text: string) {
  return [...text.matchAll(/\x1b\[([?<>=][\d;]*)u/g)].map((match) => match[1])
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

// The replies to one OSC 10, 11 or 4 query; OSC 4 may ask for several slots.
function colorReplies(query: string, palette: NonNullable<PtyCase["palette"]>, end: string) {
  const rgb = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((at) => hex.slice(at, at + 2).repeat(2))
    return `rgb:${r}/${g}/${b}`
  }
  const [code, ...rest] = query.split(";")
  if (code === "10") return `\x1b]10;${rgb(palette.foreground)}${end}`
  if (code === "11") return `\x1b]11;${rgb(palette.background)}${end}`
  return rest
    .flatMap((part, index) => (index % 2 === 0 && rest[index + 1] === "?" ? [Number(part)] : []))
    .map((slot) => `\x1b]4;${slot};${rgb(palette.colors[slot] ?? xterm(slot))}${end}`)
    .join("")
}

// xterm's color for a slot above 15.
function xterm(slot: number) {
  const hex = (value: number) => value.toString(16).padStart(2, "0")
  if (slot >= 232) return `#${hex(8 + (slot - 232) * 10).repeat(3)}`
  const cube = [0, 95, 135, 175, 215, 255]
  const index = slot - 16
  return `#${[Math.floor(index / 36), Math.floor(index / 6) % 6, index % 6].map((step) => hex(cube[step])).join("")}`
}

// Each row's background runs as `<from>-<to> <color>`, columns end-exclusive. The emulator's default background
// (black) reads `default`; a color the program wrote reads `#rrggbb`.
function backgrounds(lines: CapturedLine[], width: number) {
  return lines.map((line) => {
    const runs = line.spans.reduce<{ from: number; to: number; color: string }[]>((all, span) => {
      const [r, g, b] = span.bg.toInts()
      const color =
        r + g + b === 0 ? "default" : `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`
      const from = all.at(-1)?.to ?? 0
      const to = Math.min(width, from + span.width)
      if (from >= width) return all
      if (all.at(-1)?.color === color) return all.with(-1, { ...all.at(-1)!, to })
      return [...all, { from, to, color }]
    }, [])
    return runs.map((run) => `${run.from}-${run.to} ${run.color}`).join(", ")
  })
}

// Each row's runs of text attributes as `<from>-<to> <names>`, columns end-exclusive; plain text has no run.
function attributes(lines: CapturedLine[]) {
  const names = Object.entries(TextAttributes).filter(([, bit]) => bit !== 0)
  const named = (value: number) => names.flatMap(([name, bit]) => (value & bit ? [name.toLowerCase()] : [])).join("+")
  return lines.map((line) =>
    line.spans
      .reduce<{ from: number; to: number; value: number }[]>((all, span) => {
        const from = all.at(-1)?.to ?? 0
        return [...all, { from, to: from + span.width, value: span.attributes }]
      }, [])
      .filter((run) => run.value !== 0)
      .map((run) => `${run.from}-${run.to} ${named(run.value)}`)
      .join(", "),
  )
}

// kitty draws an OSC 66 text-sizing sequence (`ESC ] 66 ; w=N:s=N ; text ST`): `s` cells high and `w` (else the
// text's own width) times `s` wide, with the cursor after its top row. The emulator would ignore it.
function drawTextSizing(text: string) {
  const sized = /\x1b\]66;([^;\x07\x1b]*);([^\x07\x1b]*)(?:\x07|\x1b\\)/g
  return text.replace(sized, (_match, params: string, body: string) => {
    const options = new URLSearchParams(params.replaceAll(":", "&"))
    const scale = Math.max(1, Number(options.get("s") ?? 1))
    const cells = (Number(options.get("w") ?? 0) || body.length) * scale
    const below = Array.from({ length: scale - 1 }, () => `\x1b[B\x1b[${cells}D${" ".repeat(cells)}`).join("")
    return body.padEnd(cells) + below + (scale > 1 ? `\x1b[${scale - 1}A` : "")
  })
}

function kittyReplies(data: Uint8Array) {
  const text = new TextDecoder().decode(data)
  return text.replace(/\x1bP>\|[^\x1b]*\x1b\\/g, "\x1bP>|kitty(0.40.1)\x1b\\")
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
    // Read before the render: output that arrives while a frame renders shows only in the next one, so a
    // screen is final only when the program had exited before its frame began.
    const exited = done.exited
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
    if (exited && !(oscOk && screenOk)) return `exited while waiting for ${describe(step)}\n${text}`
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
    const [allowed, notes] = allowDeviations(value, records[0], records[1])
    notes.forEach((note) => console.log(`     ${name}: ${note}`))
    const report = diffRecords(records[0], allowed, sides)
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
