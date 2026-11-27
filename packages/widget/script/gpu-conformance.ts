// Writes test/fixtures/gpu/*.json (specs/v2/widgets-gpu.md, Conformance): for each program in
// test/fixtures/gpu-cases.ts, the batches it posts, run on the TypeScript host under the fixtures' driver, and the
// program errors (phase `gpu`) the host's checks give. Run `bun run script/gpu-conformance.ts` only to regenerate them
// from a prelude and host known to be right.
import path from "node:path"
import { type LiveInput, LiveWidget, ManualClock, program } from "../src/index.js"
import { type GpuCase, gpuCases, rawCases } from "../test/fixtures/gpu-cases.js"

const dir = path.resolve(import.meta.dir, "../test/fixtures/gpu")

/** The GPU the fixtures' host has. */
export const GPU = { available: true, format: "rgba8unorm" } as const
/** The frames the driver delivers: frame `i` at `t = i / 60`, on a canvas 300 x 200 at scale 2. */
const frame = (i: number) => ({ t: i / 60, dt: 1 / 60, width: 300, height: 200, scale: 2, pointer: null, dark: false })
/** The most frames a fixture runs. */
const FRAMES = 10

// A value with every number JSON can't hold (NaN, Infinity, -Infinity) as `{ $num: "NaN" }` and so on; the rest as is.
const tagged = (value: unknown): unknown => {
  if (typeof value === "number") return Number.isFinite(value) ? value : { $num: String(value) }
  if (Array.isArray(value)) return value.map(tagged)
  if (value === null || typeof value !== "object" || value instanceof ArrayBuffer) return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, tagged(item)]))
}

export interface Recorded {
  /** `bytes`: base64, or null when the program posted something other than an `ArrayBuffer`; `ops` as posted. */
  readonly batches: ReadonlyArray<{ readonly frame: boolean; readonly ops: unknown; readonly bytes: string | null }>
  readonly errors: ReadonlyArray<{ readonly message: string; readonly canvases: ReadonlyArray<string> | "all" }>
  readonly end: string
}

/**
 * Runs a case the way the fixtures' driver does: the canvas sizes before anything else, then while the program asks for
 * frames, each fixture input for frame `i`, frame `i`, and its inputs marked `after`; it stops when the program ends, or settles without asking
 * for a frame, or after `FRAMES` frames. Timers run on a clock that moves 1/60 s at a time while the program waits.
 */
export async function run(item: GpuCase): Promise<Recorded> {
  const clock = new ManualClock()
  const batches: Array<{ frame: boolean; ops: unknown; bytes: string | null }> = []
  const widget = LiveWidget.start(program(item.source, "live"), item.data ?? null, {
    clock,
    // GPU programs, not budgets: no 50 ms slice.
    busyMs: 600_000,
    gpu: { format: GPU.format },
    // Every batch, and every frame request (one without a batch has no ops and no bytes): a frame ends there.
    onMessage: (message) => {
      const batch =
        message.type === "frame"
          ? (message.gpu ?? { ops: [], bytes: new ArrayBuffer(0) })
          : message.type === "gpu"
            ? message
            : undefined
      if (batch)
        batches.push({
          frame: message.type === "frame",
          ops: tagged(batch.ops),
          bytes: batch.bytes instanceof ArrayBuffer ? Buffer.from(batch.bytes).toString("base64") : null,
        })
    },
  })
  item.canvases.forEach((canvas) => widget.canvas(canvas.key, canvas.width, canvas.height))
  // Until the program asks for a frame or ends: it may be computing (real time) or sleeping (the clock).
  const settle = async () => {
    for (let step = 0; step < 10 && !widget.ended && !widget.frameRequested; step++) {
      await Promise.race([widget.when((c) => c.frameRequested).catch(() => undefined), Bun.sleep(50)])
      if (!widget.frameRequested) await clock.advance(1000 / 60)
    }
  }
  for (let i = 0; i < FRAMES; i++) {
    await settle()
    if (widget.ended || !widget.frameRequested) break
    const send = (after: boolean) => {
      for (const { input } of (item.inputs ?? []).filter((entry) => entry.frame === i && !!entry.after === after)) {
        const given = input as LiveInput
        if (given.type === "event") widget.event(given.event)
        if (given.type === "canvas") widget.canvas(given.key, given.width, given.height)
        if (given.type === "gpu" && given.lost !== undefined)
          widget.loseDevice(given.lost, input as { inFlight?: boolean; finished?: boolean })
      }
    }
    send(false)
    widget.frame(frame(i))
    send(true)
  }
  await settle()
  const end = widget.ended ?? (await widget.stop())
  return {
    batches,
    errors: widget.gpuErrors.map((error) => ({ message: error.message, canvases: error.canvases })),
    end: end.type === "error" ? `error: ${end.error.message}` : end.type,
  }
}

// JSON, two spaces deep, with one op per line.
function format(file: Record<string, unknown>) {
  const { batches, ...rest } = file as { batches?: Recorded["batches"] | "from-source" }
  if (!Array.isArray(batches)) return JSON.stringify(file, null, 2) + "\n"
  const head = JSON.stringify(rest, null, 2).slice(0, -2)
  const body = batches.map((batch) => {
    const ops = batch.ops
    const list = !Array.isArray(ops)
      ? JSON.stringify(ops)
      : ops.length === 0
        ? "[]"
        : `[\n${ops.map((op) => `        ${JSON.stringify(op)}`).join(",\n")}\n      ]`
    return `    {\n      "frame": ${batch.frame},\n      "bytes": ${JSON.stringify(batch.bytes)},\n      "ops": ${list}\n    }`
  })
  return `${head},\n  "batches": [\n${body.join(",\n")}\n  ]\n}\n`
}

export const fixtures = (): ReadonlyArray<GpuCase & { readonly raw: boolean }> => [
  ...gpuCases.map((item) => ({ ...item, raw: false })),
  ...rawCases.map((item) => ({ ...item, raw: true })),
]

if (import.meta.main) {
  for (const item of fixtures()) {
    const recorded = await run(item)
    // A raw case's batch is in its source; one of the wrong shape (ops not a list, bytes not an ArrayBuffer) is kept
    // too, for drivers that replay batches. Batches too big to record come from running the source.
    const { batches, ...rest } = recorded
    const shape = batches.some((batch) => batch.bytes === null || !Array.isArray(batch.ops))
    const kept = item.raw && !shape ? {} : { batches: item.fromSource ? "from-source" : batches }
    const file = { ...item, raw: undefined, fromSource: undefined, gpu: GPU, ...kept, ...rest }
    await Bun.write(path.join(dir, `${item.name}.json`), format(file))
  }
  console.log(`wrote ${fixtures().length} fixtures to ${dir}`)
}
