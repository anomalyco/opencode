import { describe, expect } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { InteractiveProcess } from "@opencode-ai/core/tool/interactive/runtime"
import { fakeProcess } from "./fixture/interactive-process"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)

const spawnWith = (fake: ReturnType<typeof fakeProcess>) =>
  Effect.gen(function* () {
    const runtime = yield* InteractiveProcess.Service
    const child = yield* runtime.spawn({ command: "gdb ./a.out", cwd: "/tmp" })
    const observed = fake.spawned[0]?.child
    if (!observed) return yield* Effect.die("expected the fake child to be recorded")
    return { child, observed }
  }).pipe(Effect.provide(fake.layer))

describe("InteractiveProcess fake", () => {
  it.live("replays the scripted output schedule and signals exit", () => {
    const fake = fakeProcess({
      schedule: [{ bytes: "gdb banner\n", delayMs: 2 }, { bytes: "> ", delayMs: 6 }, { exit: 0, delayMs: 8 }],
    })
    return Effect.gen(function* () {
      const runtime = yield* InteractiveProcess.Service
      expect(runtime.pty).toBe(true)
      const { child, observed } = yield* spawnWith(fake)
      expect(fake.spawned[0]).toMatchObject({ command: "gdb ./a.out", cwd: "/tmp" })
      expect(child.pgid).toBeGreaterThan(0)

      expect(yield* child.exit).toEqual({ exitCode: 0 })
      expect(observed.exited).toBe(true)
      expect(observed.emitted).toEqual(["gdb banner\n", "> "])
    }).pipe(Effect.provide(fake.layer))
  })

  it.live("records exact stdin bytes and reacts through respond", () => {
    const fake = fakeProcess({ respond: (input) => (input === "quit\n" ? { exit: 7 } : { bytes: `got: ${input}` }) })
    return Effect.gen(function* () {
      const { child, observed } = yield* spawnWith(fake)

      yield* child.write("break main\n")
      expect(observed.writes).toEqual(["break main\n"])

      yield* child.write("quit\n")
      expect(observed.writes).toEqual(["break main\n", "quit\n"])
      expect(yield* child.exit).toEqual({ exitCode: 7 })
      expect(observed.emitted).toEqual(["got: break main\n"])
    }).pipe(Effect.provide(fake.layer))
  })

  it.live("records EOF signalling and completes exit on kill", () => {
    const fake = fakeProcess()
    return Effect.gen(function* () {
      const { child, observed } = yield* spawnWith(fake)

      expect(observed.eofs).toEqual([])
      yield* child.signalEof()
      yield* child.signalEof()
      expect(observed.eofs).toEqual([true, true])

      expect(observed.kills).toEqual([])
      yield* child.kill()
      expect(observed.kills).toEqual([true])
      expect(observed.exited).toBe(true)
      expect(yield* child.exit).toEqual({ signal: "SIGKILL" })
    }).pipe(Effect.provide(fake.layer))
  })

  it.live("finish completes the exit from the test side", () => {
    const fake = fakeProcess()
    return Effect.gen(function* () {
      const { child, observed } = yield* spawnWith(fake)

      yield* observed.finish({ exitCode: 3 })
      expect(yield* child.exit).toEqual({ exitCode: 3 })
    }).pipe(Effect.provide(fake.layer))
  })

  it.live("emit delivers awaited output into the stream", () => {
    const fake = fakeProcess()
    return Effect.gen(function* () {
      const { observed } = yield* spawnWith(fake)

      yield* observed.emit("early\n")
      yield* observed.emit("late\n", 20)
      expect(observed.emitted).toEqual(["early\n", "late\n"])
    }).pipe(Effect.provide(fake.layer))
  })

  it.live("failSpawn fails every spawn with SpawnError", () => {
    const fake = fakeProcess({ failSpawn: new Error("spawn ENOENT") })
    return Effect.gen(function* () {
      const runtime = yield* InteractiveProcess.Service
      const exit = yield* Effect.exit(runtime.spawn({ command: "./missing", cwd: "/tmp" }))
      expect(Exit.isSuccess(exit)).toBe(false)
      expect(fake.spawned).toHaveLength(0)
    }).pipe(Effect.provide(fake.layer))
  })
})
