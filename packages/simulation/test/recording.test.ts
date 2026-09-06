import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { WriteStream } from "node:fs"
import { once } from "node:events"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TextRenderable } from "@opentui/core"
import { createHarness, matches } from "../src/frontend/actions"
import { SimulationRenderer } from "../src/frontend/renderer"
import { Effect, Schema } from "effect"
import { Timeline, Pointer, type Event } from "../src/recording"

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

test("finishes the pointer sidecar on the output clock without changing the v1 timeline", async () => {
  const directory = await mkdtemp(join(tmpdir(), "simulation-pointer-recording-"))
  try {
    const path = join(directory, "timeline.jsonl")
    const timeline = await Timeline.create(path, 80, 24)
    timeline.write("before")
    timeline.pointer("move", 12, 5)
    timeline.pointer("click", 15, 6)
    timeline.write("after")
    const first = timeline.finish()
    expect(timeline.finish()).toBe(first)
    expect(await first).toBe(path)
    timeline.pointer("move", 30, 10)
    const pointers = (await Bun.file(join(directory, "timeline.pointers.jsonl")).text())
      .trim()
      .split("\n")
      .map((line) => Schema.decodeUnknownSync(Schema.fromJsonString(Pointer))(line))
    expect(pointers.map(({ action, x, y }) => ({ action, x, y }))).toEqual([
      { action: "move", x: 12, y: 5 },
      { action: "click", x: 15, y: 6 },
    ])
    const output = (await Bun.file(path).text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Event)
    const firstOutput = output[1]
    const lastOutput = output.at(-1)
    if (firstOutput?.type !== "output" || lastOutput?.type !== "output") throw new Error("missing output")
    expect(pointers[0]?.atMs).toBeGreaterThanOrEqual(firstOutput.at_ms)
    expect(pointers[1]?.atMs).toBeLessThanOrEqual(lastOutput.at_ms)
    expect(output.every((event) => ["header", "output", "resize"].includes(event.type))).toBe(true)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test.each(["pointer", "output"])("joins both recording streams after an early %s failure", async (failed) => {
  const directory = await mkdtemp(join(tmpdir(), "simulation-pointer-failure-"))
  try {
    const timeline = await Timeline.create(join(directory, "timeline.jsonl"), 80, 24)
    if (failed === "pointer") await mkdir(join(directory, "timeline.pointers.jsonl"))
    const error = new Promise<Error>((resolve) => timeline.once("error", resolve))
    timeline.pointer("move", 10, 5)
    const output: unknown = Reflect.get(timeline, "output")
    const pointers: unknown = Reflect.get(timeline, "pointers")
    if (!(output instanceof WriteStream) || !(pointers instanceof WriteStream)) throw new Error("missing owned streams")
    if (failed === "output") {
      if (pointers.pending) await once(pointers, "open")
      output.destroy(new Error("output failed"))
    }
    const failure = await error
    const finishing = timeline.finish()
    expect(timeline.finish()).toBe(finishing)
    await expect(finishing).rejects.toBe(failure)
    expect(output.closed).toBe(true)
    expect(pointers.closed).toBe(true)
    expect(Reflect.get(output, "fd")).toBeNull()
    expect(Reflect.get(pointers, "fd")).toBeNull()
    timeline.pointer("move", 99, 99)
    expect(timeline.finish()).toBe(finishing)
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
