import type { CliRenderer, CliRendererConfig } from "@opentui/core"
import { createTestRenderer, type TestRendererSetup } from "@opentui/core/testing"
import { Effect } from "effect"
import { Timeline } from "../recording"

const setups = new WeakMap<CliRenderer, TestRendererSetup>()
const recordings = new WeakMap<CliRenderer, Timeline>()

/**
 * Creates a headless renderer with optional recording: a real CliRenderer
 * backed by an in-memory screen buffer. The TestRendererSetup is kept
 * module-side so the harness can use supported testing APIs without app
 * code carrying it around.
 */
export interface Viewport {
  readonly cols: number
  readonly rows: number
}

export const create = Effect.fn("SimulationRenderer.create")(function* (
  options: CliRendererConfig,
  path?: string,
  viewport?: Viewport,
) {
  const cols = viewport?.cols ?? 100
  const rows = viewport?.rows ?? 40
  const recording = path
    ? yield* Effect.acquireRelease(
        Effect.tryPromise(() => Timeline.create(path, cols, rows)),
        (recording) =>
          Effect.tryPromise(() => recording.finish()).pipe(
            Effect.catch((error) =>
              Effect.sync(() => process.stderr.write(`Failed to finish UI recording: ${error}\n`)),
            ),
          ),
      )
    : undefined
  const setup = yield* Effect.acquireRelease(
    Effect.tryPromise(() =>
      createTestRenderer({
        ...options,
        width: cols,
        height: rows,
        ...(recording
          ? {
              stdout: recording as unknown as NodeJS.WriteStream,
              bufferedOutput: "stdout" as const,
            }
          : {}),
      }),
    ),
    (setup) =>
      Effect.sync(() => {
        if (!setup.renderer.isDestroyed) setup.renderer.destroy()
      }),
  )
  setups.set(setup.renderer, setup)
  if (recording) recordings.set(setup.renderer, recording)
  return setup.renderer
})

export function recordResize(renderer: CliRenderer, cols: number, rows: number) {
  recordings.get(renderer)?.resize(cols, rows)
}

export function setupFor(renderer: CliRenderer): TestRendererSetup | undefined {
  return setups.get(renderer)
}

export function finish(renderer: CliRenderer) {
  const recording = recordings.get(renderer)
  if (!recording) return Effect.fail(new Error("UI recording is not available"))
  return Effect.tryPromise(() => recording.finish())
}

export * as SimulationRenderer from "./renderer"
