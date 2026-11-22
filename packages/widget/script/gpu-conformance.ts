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

export interface Recorded {
  readonly batches: ReadonlyArray<{ readonly frame: boolean; readonly ops: unknown; readonly bytes: string }>
  readonly errors: ReadonlyArray<{ readonly message: string; readonly canvases: ReadonlyArray<string> | "all" }>
  readonly end: string
}

/**
 * Runs a case the way the fixtures' driver does: the canvas sizes before anything else, then while the program asks for
 * frames, each fixture input for frame `i` and frame `i`; it stops when the program ends, or settles without asking
 * for a frame, or after `FRAMES` frames. Timers run on a clock that moves 1/60 s at a time while the program waits.
 */
export async function run(item: GpuCase): Promise<Recorded> {
  const clock = new ManualClock()
  const batches: Array<{ frame: boolean; ops: unknown; bytes: string }> = []
  const widget = LiveWidget.start(program(item.source), item.data ?? null, {
    clock,
    // GPU programs, not budgets: no 50 ms slice.
    busyMs: 600_000,
    gpu: { format: GPU.format },
    onMessage: (message) => {
      const batch = message.type === "frame" ? message.gpu : message.type === "gpu" ? message : undefined
      if (batch)
        batches.push({
          frame: message.type === "frame",
          ops: batch.ops,
          bytes: Buffer.from(batch.bytes).toString("base64"),
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
    for (const { input } of (item.inputs ?? []).filter((entry) => entry.frame === i)) {
      const given = input as LiveInput
      if (given.type === "event") widget.event(given.event)
      if (given.type === "canvas") widget.canvas(given.key, given.width, given.height)
    }
    widget.frame(frame(i))
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
  const { batches, ...rest } = file as { batches?: Recorded["batches"] }
  const head = JSON.stringify(rest, null, 2).slice(0, -2)
  if (!batches) return head + "\n}\n"
  const body = batches.map(
    (batch) =>
      `    {\n      "frame": ${batch.frame},\n      "bytes": ${JSON.stringify(batch.bytes)},\n      "ops": [\n` +
      (batch.ops as ReadonlyArray<unknown>).map((op) => `        ${JSON.stringify(op)}`).join(",\n") +
      `\n      ]\n    }`,
  )
  return `${head},\n  "batches": [\n${body.join(",\n")}\n  ]\n}\n`
}

export const fixtures = (): ReadonlyArray<GpuCase & { readonly raw: boolean }> => [
  ...gpuCases.map((item) => ({ ...item, raw: false })),
  ...rawCases.map((item) => ({ ...item, raw: true })),
]

if (import.meta.main) {
  for (const item of fixtures()) {
    const recorded = await run(item)
    // A raw case's batch is in its source.
    const { batches, ...rest } = recorded
    const file = { ...item, raw: undefined, gpu: GPU, ...(item.raw ? {} : { batches }), ...rest }
    await Bun.write(path.join(dir, `${item.name}.json`), format(file))
  }
  console.log(`wrote ${fixtures().length} fixtures to ${dir}`)
}
