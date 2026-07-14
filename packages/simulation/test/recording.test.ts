import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TextRenderable } from "@opentui/core"
import { createHarness, matches } from "../src/frontend/actions"
import { SimulationRenderer } from "../src/frontend/renderer"
import { Effect } from "effect"
import { Timeline, type Event } from "../src/recording"

test("streams ANSI chunks into a versioned JSONL timeline", async () => {
  const directory = await mkdtemp(join(tmpdir(), "simulation-recording-"))
  const path = join(directory, "nested", "timeline.jsonl")

  try {
    const timeline = await Timeline.create(path, 80, 24)
    await new Promise<void>((resolve, reject) => {
      timeline.write(Buffer.from("\u001b[2Jhello"), (error) => (error ? reject(error) : resolve()))
    })
    timeline.resize(100, 30)
    expect(await timeline.finish()).toBe(path)
    await new Promise<void>((resolve) => timeline.write(Buffer.from("ignored"), () => resolve()))

    const events = (await Bun.file(path).text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Event)
    expect(events[0]).toEqual({ type: "header", version: 1, cols: 80, rows: 24, encoding: "base64" })
    expect(events[1]?.type).toBe("output")
    if (events[1]?.type !== "output") throw new Error("Missing output event")
    expect(Buffer.from(events[1].data, "base64").toString()).toBe("\u001b[2Jhello")
    expect(events[1].at_ms).toBeGreaterThanOrEqual(0)
    expect(events[2]).toMatchObject({ type: "resize", cols: 100, rows: 30 })
    expect(events.at(-1)).toMatchObject({ type: "output", data: "" })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("captures native renderer output and finishes on destroy", async () => {
  const directory = await mkdtemp(join(tmpdir(), "simulation-renderer-recording-"))
  const path = join(directory, "timeline.jsonl")

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const renderer = yield* SimulationRenderer.create({}, path)
          yield* Effect.promise(() => SimulationRenderer.setupFor(renderer)?.renderOnce() ?? Promise.resolve())
          renderer.destroy()
          expect(yield* SimulationRenderer.finish(renderer)).toBe(path)

          const events = (yield* Effect.promise(() => Bun.file(path).text()))
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line) as Event)
          expect(events.some((event) => event.type === "output")).toBe(true)
        }),
      ),
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("matches live screen text while recording", async () => {
  const directory = await mkdtemp(join(tmpdir(), "simulation-recording-matches-"))
  const path = join(directory, "timeline.jsonl")

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const renderer = yield* SimulationRenderer.create({}, path)
          renderer.root.add(new TextRenderable(renderer, { content: "recorded screen text" }))
          yield* Effect.promise(() => SimulationRenderer.setupFor(renderer)?.renderOnce() ?? Promise.resolve())

          expect(matches(createHarness(renderer), "recorded screen text")).toBe(true)
        }),
      ),
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
