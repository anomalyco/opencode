import { describe, expect } from "bun:test"
import { Effect, Fiber, PlatformError, Schema, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { TestClock } from "effect/testing"
import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { Environment } from "../src/environment/index"
import { Machine } from "../src/machine/index"
import { makeWorker } from "./fixture/machine-worker"
import { environmentConformance } from "./lib/environment-conformance"
import { it } from "./lib/effect"

const connected = Effect.gen(function* () {
  const machine = Machine.make(Environment.ID.make("gpu"))
  const worker = makeWorker(machine)
  yield* worker.restore
  return { worker, environment: machine.environment }
})

const command = ChildProcess.make("/bin/sh", ["-c", "make"], { cwd: "/work" })
const bytes = (value: string) => new TextEncoder().encode(value)
const text = (stream: Stream.Stream<Uint8Array, PlatformError.PlatformError>) =>
  Stream.mkString(Stream.decodeText(stream))
const cause = (error: PlatformError.PlatformError) => error.reason.cause

describe("machine driver", () => {
  it.effect("runs a command and reports its output and exit code", () =>
    Effect.gen(function* () {
      const { worker, environment } = yield* connected
      const handle = yield* environment.spawner.spawn(
        ChildProcess.make("/bin/sh", ["-c", "echo hi"], { cwd: "/work", env: { K: "V", UNSET: undefined } }),
      )
      const run = worker.runs[0]
      expect([run.argv, run.cwd, run.env]).toEqual([["/bin/sh", "-c", "echo hi"], "/work", { K: "V" }])
      expect(handle.pid).toBe(ChildProcessSpawner.ProcessId(run.pid))
      yield* run.print("hi\n")
      yield* run.exit(3)
      expect(yield* text(handle.all)).toBe("hi\n")
      expect(yield* handle.exitCode).toBe(ChildProcessSpawner.ExitCode(3))
    }),
  )

  it.effect("delivers large output complete and in order", () =>
    Effect.gen(function* () {
      const { worker, environment } = yield* connected
      const handle = yield* environment.spawner.spawn(command)
      const chunks = Array.from({ length: 256 }, (_, index) => new Uint8Array(4096).fill(index))
      yield* Effect.forEach(chunks, worker.runs[0].print)
      yield* worker.runs[0].exit(0)
      const received = Buffer.concat(yield* Stream.runCollect(handle.all))
      expect(received.equals(Buffer.concat(chunks))).toBe(true)
    }),
  )

  it.effect("resumes output after a lost connection with no gap and no repeat", () =>
    Effect.gen(function* () {
      const { worker, environment } = yield* connected
      const handle = yield* environment.spawner.spawn(command)
      const run = worker.runs[0]
      yield* run.print("a")
      yield* run.print("b")
      yield* worker.cut
      yield* run.print("c")
      yield* worker.restore
      yield* run.print("d")
      yield* run.exit(2)
      expect(yield* text(handle.all)).toBe("abcd")
      expect(yield* handle.exitCode).toBe(ChildProcessSpawner.ExitCode(2))
    }),
  )

  it.effect("delivers the rest of a process that finished while disconnected", () =>
    Effect.gen(function* () {
      const { worker, environment } = yield* connected
      const handle = yield* environment.spawner.spawn(command)
      const run = worker.runs[0]
      yield* run.print("before ")
      yield* worker.cut
      yield* run.print("during")
      yield* run.exit(7)
      yield* worker.restore
      expect(yield* text(handle.all)).toBe("before during")
      expect(yield* handle.exitCode).toBe(ChildProcessSpawner.ExitCode(7))
    }),
  )

  it.effect("attaches again when an exit counts bytes that never arrived", () =>
    Effect.gen(function* () {
      const { worker, environment } = yield* connected
      const handle = yield* environment.spawner.spawn(command)
      const run = worker.runs[0]
      yield* run.print("a")
      worker.drop("home", "output")
      yield* run.print("b")
      yield* run.print("c")
      yield* run.exit(0)
      expect(yield* text(handle.all)).toBe("abc")
      expect(yield* handle.exitCode).toBe(ChildProcessSpawner.ExitCode(0))
    }),
  )

  it.effect("fails at once with NotSent when there is no connection", () =>
    Effect.gen(function* () {
      const environment = Machine.make(Environment.ID.make("gpu")).environment
      const spawn = yield* environment.spawner.spawn(command).pipe(Effect.flip)
      expect(cause(spawn)).toBeInstanceOf(Machine.NotSent)
      expect(spawn.message).toContain("gpu is offline, command not sent")
      const read = yield* environment.files.read("/work/file").pipe(Effect.flip)
      expect(read).toBeInstanceOf(Environment.Failed)
      expect(read._tag === "Environment.Failed" && read.cause).toBeInstanceOf(Machine.NotSent)
    }),
  )

  it.effect("reports NotSent when the worker never received the start", () =>
    Effect.gen(function* () {
      const { worker, environment } = yield* connected
      worker.drop("worker", "start")
      const spawn = yield* Effect.forkChild(Effect.scoped(environment.spawner.spawn(command)), {
        startImmediately: true,
      })
      yield* worker.cut
      yield* worker.restore
      expect(cause(yield* Fiber.join(spawn).pipe(Effect.flip))).toBeInstanceOf(Machine.NotSent)
      expect(worker.runs).toHaveLength(0)
    }),
  )

  it.effect("reports Unknown when the worker stays away past the start grace", () =>
    Effect.gen(function* () {
      const { worker, environment } = yield* connected
      worker.drop("home", "started")
      const spawn = yield* Effect.forkChild(Effect.scoped(environment.spawner.spawn(command)), {
        startImmediately: true,
      })
      yield* worker.cut
      yield* Effect.yieldNow
      yield* TestClock.adjust("15 seconds")
      const error = yield* Fiber.join(spawn).pipe(Effect.flip)
      expect(cause(error)).toBeInstanceOf(Machine.Unknown)
      expect(error.message).toContain("Lost connection to gpu. The command may or may not have started.")
      expect(worker.runs).toHaveLength(1)
    }),
  )

  it.effect("carries on when the worker comes back listing the start", () =>
    Effect.gen(function* () {
      const { worker, environment } = yield* connected
      worker.drop("home", "started")
      const spawn = yield* Effect.forkChild(environment.spawner.spawn(command), { startImmediately: true })
      yield* worker.cut
      yield* Effect.yieldNow
      yield* TestClock.adjust("10 seconds")
      yield* worker.restore
      const handle = yield* Fiber.join(spawn)
      const run = worker.runs[0]
      expect(handle.pid).toBe(ChildProcessSpawner.ProcessId(run.pid))
      yield* run.print("ok")
      yield* run.exit(0)
      expect(yield* text(handle.all)).toBe("ok")
      expect(yield* handle.exitCode).toBe(ChildProcessSpawner.ExitCode(0))
    }),
  )

  it.effect("fails a running process with WorkerRestarted when the worker restarts", () =>
    Effect.gen(function* () {
      const { worker, environment } = yield* connected
      const handle = yield* environment.spawner.spawn(command)
      yield* worker.runs[0].print("partial")
      yield* worker.restart
      expect(cause(yield* handle.exitCode.pipe(Effect.flip))).toBeInstanceOf(Machine.WorkerRestarted)
      expect(cause(yield* Stream.runDrain(handle.all).pipe(Effect.flip))).toBeInstanceOf(Machine.WorkerRestarted)
    }),
  )

  it.effect("kills a running process and reports the signal", () =>
    Effect.gen(function* () {
      const { environment } = yield* connected
      const handle = yield* environment.spawner.spawn(command)
      yield* handle.kill()
      expect(yield* handle.isRunning).toBe(false)
      const killed = cause(yield* handle.exitCode.pipe(Effect.flip))
      expect(killed).toBeInstanceOf(CrossSpawnSpawner.KilledBySignal)
      expect(killed instanceof CrossSpawnSpawner.KilledBySignal && killed.signal).toBe("SIGTERM")
    }),
  )

  it.effect("returns from kill at once when the process already exited, even offline", () =>
    Effect.gen(function* () {
      const { worker, environment } = yield* connected
      const handle = yield* environment.spawner.spawn(command)
      yield* worker.runs[0].exit(0)
      expect(yield* handle.exitCode).toBe(ChildProcessSpawner.ExitCode(0))
      yield* worker.cut
      yield* handle.kill()
      yield* worker.restore
      expect(worker.received.filter((message) => message.type === "kill")).toHaveLength(0)
    }),
  )

  it.effect("replaces a connection with a newer one before the old one is seen to close", () =>
    Effect.gen(function* () {
      const { worker, environment } = yield* connected
      const handle = yield* environment.spawner.spawn(command)
      const run = worker.runs[0]
      yield* run.print("a")
      worker.drop("home", "fs")
      const waiting = yield* Effect.forkChild(environment.files.stat("/work"), { startImmediately: true })
      const closeOld = yield* worker.redial
      const error = yield* Fiber.join(waiting).pipe(Effect.flip)
      expect(error._tag === "Environment.Failed" && error.cause).toBeInstanceOf(Machine.Unknown)
      yield* run.print("b")
      yield* environment.files.write("/work/on-new.txt", bytes("new"))
      yield* closeOld
      yield* run.print("c")
      yield* run.exit(0)
      expect(yield* text(handle.all)).toBe("abc")
      expect(yield* handle.exitCode).toBe(ChildProcessSpawner.ExitCode(0))
      expect(new TextDecoder().decode((yield* environment.files.read("/work/on-new.txt")).bytes)).toBe("new")
    }),
  )

  it.effect("rejects stdin at spawn", () =>
    Effect.gen(function* () {
      const { worker, environment } = yield* connected
      const error = yield* environment.spawner
        .spawn(ChildProcess.make("cat", [], { cwd: "/work", stdin: Stream.make(bytes("input")) }))
        .pipe(Effect.flip)
      expect(error.message).toContain("stdin is not supported on gpu")
      expect(worker.runs).toHaveLength(0)
    }),
  )

  it.effect("round-trips the file operations", () =>
    Effect.gen(function* () {
      const { environment } = yield* connected
      const files = environment.files
      yield* files.mkdir("/work/out")
      yield* files.write("/work/a.txt", bytes("hello"))
      yield* files.append("/work/a.txt", bytes(" world"))
      yield* files.append("/work/new.txt", bytes("made"))
      expect(new TextDecoder().decode((yield* files.read("/work/a.txt", { offset: 6, length: 5 })).bytes)).toBe("world")
      expect((yield* files.stat("/work/a.txt")).size).toBe(11)
      yield* files.move("/work/a.txt", "/work/out")
      expect(yield* files.list("/work/out")).toEqual([{ name: "a.txt", type: "file" }])
      expect(new TextDecoder().decode((yield* files.read("/work/new.txt")).bytes)).toBe("made")
      yield* files.remove("/work/out")
      expect(yield* files.stat("/work/out").pipe(Effect.flip)).toBeInstanceOf(Environment.NotFound)
      expect(yield* files.list("/work/new.txt").pipe(Effect.flip)).toBeInstanceOf(Environment.WrongKind)
    }),
  )

  it.effect("fails a waiting file call with Unknown as soon as the connection is lost", () =>
    Effect.gen(function* () {
      const { worker, environment } = yield* connected
      worker.drop("home", "fs")
      const read = yield* Effect.forkChild(environment.files.stat("/work"), { startImmediately: true })
      yield* worker.cut
      const error = yield* Fiber.join(read).pipe(Effect.flip)
      expect(error).toBeInstanceOf(Environment.Failed)
      expect(error._tag === "Environment.Failed" && error.cause).toBeInstanceOf(Machine.Unknown)
    }),
  )
})

describe("machine wire", () => {
  it.effect("encodes bytes as base64 and decodes them back", () =>
    Effect.sync(() => {
      const output: Machine.FromWorker = { type: "output", id: "p1", offset: 0, data: bytes("hi") }
      const write: Machine.ToWorker = { type: "fs", req: 7, call: "write", path: "/a", bytes: bytes("hi") }
      const json = JSON.parse(JSON.stringify(Schema.encodeSync(Machine.FromWorker)(output)))
      expect(json).toEqual({ type: "output", id: "p1", offset: 0, data: "aGk=" })
      expect(Schema.decodeUnknownSync(Machine.FromWorker)(json)).toEqual(output)
      expect(Schema.encodeSync(Machine.ToWorker)(write)).toEqual({ ...write, bytes: "aGk=" })
      expect(Schema.decodeUnknownSync(Machine.ToWorker)({ ...write, bytes: "aGk=" })).toEqual(write)
    }),
  )
})

environmentConformance("machine environment", () =>
  Effect.gen(function* () {
    const machine = Machine.make(Environment.ID.make("gpu"))
    const worker = makeWorker(machine)
    yield* worker.restore
    return {
      files: machine.environment.files,
      root: `/workspace-${crypto.randomUUID()}`,
      symlink: worker.files.symlink,
      dispose: worker.cut,
    }
  }),
)
