#!/usr/bin/env bun
// The GPU conformance fixtures (`packages/widget/test/fixtures/gpu/*.json`, read in place): each program runs on this
// host's WebAssembly (the worker's `LiveRun`, from wasm/) under the fixtures' driver, and must post the same batches
// (ops, and bytes byte for byte), give the same program errors from the host checks (src/gpu-checks.ts, which the page
// runs before replaying), and end the same way. Needs scripts/build-wasm.sh first.
//
//   bun scripts/gpu-fixtures.ts [name...]

import path from "node:path"
import { initSync, Program } from "../wasm/widget_web.js"
import { canvasSize, gpuChecks } from "../src/gpu-checks.ts"
import { Strikes } from "../src/watchdog.ts"
import { restoreNonFinite } from "../src/protocol.ts"

const root = path.resolve(import.meta.dir, "..")
const widget = path.resolve(root, "../../widget")
const dir = path.join(widget, "test/fixtures")
initSync({ module: await Bun.file(path.join(root, "wasm/widget_web_bg.wasm")).arrayBuffer() })
// A live program: the prelude, the live prelude, then the source (widgets.md, Prelude and step ABI).
const prelude =
  (await Bun.file(path.join(widget, "src/prelude.js")).text()) + "\n" + (await Bun.file(path.join(widget, "src/prelude-live.js")).text())

interface Fixture {
  name: string
  source: string
  data?: unknown
  canvases: Array<{ key: string; width: number; height: number }>
  inputs?: Array<{ frame: number; after?: boolean; input: { type: string; key?: string; width?: number; height?: number; lost?: string; inFlight?: boolean; finished?: boolean } }>
  gpu: { available: boolean; format: string }
  // `"from-source"`: too many to record; the run's own are the batches (its errors and end are still compared).
  batches?: Array<{ frame: boolean; ops: unknown; bytes: string | null }> | "from-source"
  errors: Array<{ message: string; canvases: string[] | "all" }>
  end: string
}

/** A value with every number JSON can't hold (NaN, Infinity, -Infinity) as `{ $num: "NaN" }` and so on, as the
 * fixtures write ops; the rest as is. */
const tagged = (value: unknown): unknown => {
  if (typeof value === "number") return Number.isFinite(value) ? value : { $num: String(value) }
  if (Array.isArray(value)) return value.map(tagged)
  if (value === null || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, tagged(item)]))
}

/** The fixtures' ops read back: `{ $num }` as its number. */
const untagged = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(untagged)
  if (value === null || typeof value !== "object") return value
  const entries = Object.entries(value)
  if (entries.length === 1 && entries[0]![0] === "$num") return Number(entries[0]![1])
  return Object.fromEntries(entries.map(([key, item]) => [key, untagged(item)]))
}

/** Equal, NaN to NaN. */
const same = (a: unknown, b: unknown): boolean =>
  Object.is(a, b) ||
  (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => same(item, b[i]))) ||
  (!!a && !!b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b) &&
    Object.keys(a).length === Object.keys(b).length &&
    Object.entries(a).every(([key, item]) => same(item, (b as Record<string, unknown>)[key])))

/** Frame `i` at `t = i / 60`, on a canvas 300 x 200 at scale 2. */
const frame = (i: number) => ({ t: i / 60, dt: 1 / 60, width: 300, height: 200, scale: 2, pointer: null, dark: false })
const FRAMES = 10

async function run(f: Fixture) {
  const program = new Program(prelude + "\n" + f.source + "\nreturn await __widget_live(__input(), true)")
  const live = program.startLive(JSON.stringify({ data: f.data ?? null, gpu: f.gpu }), { native: true, sliceBudgetMs: 600_000 })
  // `bytes`: base64, or null for a posted value other than an `ArrayBuffer`; `ops` as posted.
  const batches: Array<{ frame: boolean; ops: unknown; bytes: string | null }> = []
  const errors: Array<{ message: string; canvases: readonly string[] | "all" }> = []
  let keys = new Set<string>()
  const checks = gpuChecks(() => keys)
  let requested = false
  let ended = false
  // The outbox in order: renders give the GPU canvases' keys, batches are recorded and checked as the page does.
  const flush = () => {
    const out = JSON.parse(live.takeOutbox()) as Array<{ type: string; message?: Record<string, unknown> }>
    let bytes: Uint8Array | undefined
    for (const e of out) {
      const m = e.message
      if (e.type !== "post" || !m) continue
      if (m.type === "render") keys = new Set(Object.keys((m.gpu as object) ?? {}))
      // A frame request ends a frame: recorded (`frame: true`, without a batch as no ops and no bytes) and the
      // per-frame counts start again. One while a frame is pending isn't one: its batch, if any, is a plain batch.
      const frame = m.type === "frame" && !requested
      if (m.type === "frame") requested = true
      const value = m.type === "frame" ? m.gpu : m.type === "gpu" ? m.batch : undefined
      if (value === undefined) {
        if (frame) {
          batches.push({ frame: true, ops: [], bytes: "" })
          checks.frame()
        }
        continue
      }
      const batch = value as { ops?: unknown; bytes?: unknown; nonFinite?: unknown }
      if (batch && typeof batch === "object" && batch.nonFinite !== undefined) restoreNonFinite(batch)
      if (batch && typeof batch === "object" && Array.isArray(batch.bytes)) {
        bytes ??= live.takeBytes()
        const [offset, length] = batch.bytes as [number, number]
        batch.bytes = bytes.subarray(offset, offset + length)
      }
      if (batch && typeof batch === "object")
        batches.push({ frame, ops: batch.ops, bytes: batch.bytes instanceof Uint8Array ? Buffer.from(batch.bytes).toString("base64") : null })
      const checked = checks.batch(value)
      if (checked.error) errors.push({ message: checked.error.message, canvases: checked.error.canvases })
      if (frame) checks.frame()
    }
  }
  /** Runs until the program waits on the host; the ms until its next timer, or -1. */
  const pump = () => {
    for (;;) {
      const r = live.pump(50)
      flush()
      if (r === -3) {
        ended = true
        return -1
      }
      if (r !== -2) return r
    }
  }
  const deliver = (message: unknown) => live.deliver(JSON.stringify(message))
  // Until the program asks for a frame or ends; its timers run while it waits (a sixtieth of a second at a time).
  const settle = async () => {
    for (let step = 0; step < 10 && !ended && !requested; step++) {
      const timer = pump()
      if (ended || requested) break
      if (timer >= 0) await Bun.sleep(Math.min(timer, 1000 / 60) + 1)
    }
  }
  // As the page sends them: a canvas's size clamped to the texture limit; a device loss lost by the checks first, a
  // strike before that when the run had GPU work in flight (`inFlight`, not sent) and some finished since its last
  // strike (`finished`, default true: since the previous loss): a second within 30 s stops the run.
  let now = 0
  const strikes = new Strikes(() => now)
  const input = (given: { type: string; key?: string; width?: number; height?: number; lost?: string; inFlight?: boolean; finished?: boolean }) => {
    if (given.type === "canvas") {
      const [width, height] = canvasSize(given.width!, given.height!)
      return deliver({ type: "canvas", key: given.key, width, height })
    }
    if (given.type === "gpu" && given.lost !== undefined) {
      if (given.finished !== false) strikes.done()
      const hang = given.inFlight === true && strikes.strike() ? checks.hung() : undefined
      if (hang) errors.push({ message: hang.message, canvases: hang.canvases })
      checks.lost()
      return deliver({ type: "gpu", lost: given.lost })
    }
    deliver(given)
  }
  for (const c of f.canvases) input({ type: "canvas", ...c })
  for (let i = 0; i < FRAMES; i++) {
    await settle()
    if (ended || !requested) break
    now = (i * 1000) / 60
    const send = (after: boolean) => {
      for (const entry of (f.inputs ?? []).filter((entry) => entry.frame === i && !!entry.after === after)) input(entry.input)
    }
    send(false)
    requested = false
    deliver({ type: "frame", frame: frame(i) })
    send(true)
  }
  await settle()
  if (!ended) {
    live.stop()
    flush()
  }
  const exit = JSON.parse(live.exit() ?? '{"type":"stopped"}') as { type: string; error?: { message: string } }
  const end = exit.type === "finished" ? "return" : exit.type === "failed" ? `error: ${exit.error!.message}` : "stop"
  live.free()
  program.free()
  return { batches, errors, end }
}

const only = process.argv.slice(2)
const files = [...new Bun.Glob("*.json").scanSync(path.join(dir, "gpu"))].sort()
let failed = 0
for (const file of files) {
  const f = (await Bun.file(path.join(dir, "gpu", file)).json()) as Fixture
  if (only.length > 0 && !only.includes(f.name)) continue
  const started = performance.now()
  const got = await run(f)
  const problems: string[] = []
  if (Array.isArray(f.batches)) {
    const batches = f.batches
    if (got.batches.length !== batches.length) problems.push(`${got.batches.length} batches, want ${batches.length}`)
    batches.forEach((want, i) => {
      const have = got.batches[i]
      if (!have) return
      if (have.frame !== want.frame) problems.push(`batch ${i}: frame ${have.frame}, want ${want.frame}`)
      // Written with tags as the fixtures are, and the fixtures' read back as numbers: both the same.
      if (JSON.stringify(tagged(have.ops)) !== JSON.stringify(want.ops) || !same(have.ops, untagged(want.ops)))
        problems.push(`batch ${i}: ops differ`)
      if (have.bytes !== want.bytes) problems.push(`batch ${i}: bytes differ (${have.bytes?.length ?? null} vs ${want.bytes?.length ?? null} base64 chars)`)
    })
  }
  if (JSON.stringify(got.errors) !== JSON.stringify(f.errors)) problems.push(`errors ${JSON.stringify(got.errors)}, want ${JSON.stringify(f.errors)}`)
  if (got.end !== f.end) problems.push(`end ${got.end}, want ${f.end}`)
  const ms = (performance.now() - started).toFixed(0)
  if (problems.length > 0) failed++
  console.log(`${problems.length === 0 ? "ok  " : "FAIL"} ${f.name} (${f.batches ? `${Array.isArray(f.batches) ? `${f.batches.length} batches` : `${got.batches.length} batches from source`}, ` : ""}${f.errors.length} errors, ${ms} ms)${problems.length ? "\n     " + problems.join("\n     ") : ""}`)
}

// Non-finite numbers in ops (widgets-gpu.md, Transport): numbers are read as they are, so NaN and infinities fail the
// check that reads them, never becoming null. Each case's ops go through this host's transport and must give the error
// gpu.ts gives (written here), which the checks also give on the ops as posted, before any transport. A null would pass
// where the field may be null (rowsPerImage, depthClearValue).
const VIEW = `{ dimension: "2d", baseMipLevel: 0, mipLevelCount: 1, baseArrayLayer: 0, arrayLayerCount: 1 }`
const nonFinite: Array<{ name: string; ops: string; error: { message: string; canvases: string[] | "all" } }> = [
  {
    name: "NaN in a nullable whole number",
    ops: `[["buffer", 1, 256, 4], ["texture", 2, 4, 4, 1, "rgba8unorm", 2, 1, 1], ["copyBufferToTexture", 1, 0, 256, NaN, 2, 0, [0, 0, 0], [1, 1, 1]]]`,
    error: { message: 'gpu op 2: "copyBufferToTexture" argument 4 must be a whole number', canvases: "all" },
  },
  {
    name: "NaN in a nullable finite number",
    ops: `[["texture", 1, 4, 4, 1, "depth24plus", 16, 1, 1], ["view", 2, 1, ${VIEW}], ["pass", { colorAttachments: [], depthStencilAttachment: { view: 2, depthClearValue: NaN, depthLoadOp: "clear", depthStoreOp: "store", depthReadOnly: false } }], ["end"]]`,
    error: { message: 'gpu op 2: "pass" argument 1.depthStencilAttachment.depthClearValue must be a finite number', canvases: "all" },
  },
  {
    name: "Infinity in a clear value",
    ops: `[["context", 1, "scene", "rgba8unorm", "opaque"], ["view", 2, 1, ${VIEW}], ["pass", { colorAttachments: [{ view: 2, resolveTarget: null, clearValue: [0, Infinity, 0, 1], loadOp: "clear", storeOp: "store" }], depthStencilAttachment: null }], ["end"]]`,
    error: { message: 'gpu op 2: "pass" argument 1.colorAttachments[0].clearValue[1] must be a finite number', canvases: ["scene"] },
  },
  {
    name: "-Infinity as a size",
    ops: `[["buffer", 1, -Infinity, 4]]`,
    error: { message: 'gpu op 0: "buffer" argument 2 must be a whole number', canvases: "all" },
  },
  { name: "NaN as the ops", ops: `NaN`, error: { message: "a batch's ops must be a list", canvases: "all" } },
]
for (const c of nonFinite) {
  if (only.length > 0 && !only.includes(c.name)) continue
  const source = `async function main() {
  widget.render(ui.canvas({ key: "scene", gpu: true, height: 100 }))
  __host.post({ type: "gpu", ops: ${c.ops}, bytes: new ArrayBuffer(0) })
  await widget.frame()
}`
  const got = await run({ name: c.name, source, canvases: [{ key: "scene", width: 200, height: 200 }], gpu: { available: true, format: "rgba8unorm" }, errors: [], end: "return" })
  const direct = gpuChecks(() => new Set(["scene"])).batch({ ops: new Function(`return ${c.ops}`)(), bytes: new Uint8Array(0) }).error
  const want = JSON.stringify([c.error])
  const problems = [
    JSON.stringify(got.errors) !== want && `errors ${JSON.stringify(got.errors)}, want ${want}`,
    JSON.stringify(direct && [{ message: direct.message, canvases: direct.canvases }]) !== want && `as posted, before transport: ${JSON.stringify(direct)}`,
    got.end !== "return" && `end ${got.end}`,
  ].filter(Boolean)
  if (problems.length > 0) failed++
  console.log(`${problems.length === 0 ? "ok  " : "FAIL"} ${c.name}${problems.length ? "\n     " + problems.join("\n     ") : ""}`)
}
console.log(failed === 0 ? "all GPU fixtures pass" : `${failed} GPU fixture(s) failed`)
process.exit(failed === 0 ? 0 : 1)
