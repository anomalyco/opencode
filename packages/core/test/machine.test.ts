import { describe, expect } from "bun:test"
import { Deferred, Effect, Exit, Fiber, PlatformError, Queue, Scheduler, Schema, Scope, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { TestClock } from "effect/testing"
import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { Environment } from "../src/environment/index"
import { Machine } from "../src/machine/index"
import messages from "./fixture/machine-v3.json"
import { makeWorker } from "./fixture/machine-worker"
import { environmentConformance } from "./lib/environment-conformance"
import { it } from "./lib/effect"

const connected = Effect.gen(function* () {
  const machine = Machine.make(Environment.ID.make("gpu"))
  const worker = yield* makeWorker(machine)
  yield* worker.restore
  return { worker, environment: machine.environment }
})

const command = ChildProcess.make("/bin/sh", ["-c", "make"], { cwd: "/work" })
const bytes = (value: string) => new TextEncoder().encode(value)
const text = (stream: Stream.Stream<Uint8Array, PlatformError.PlatformError>) =>
  Stream.mkString(Stream.decodeText(stream))
const cause = (error: PlatformError.PlatformError) => error.reason.cause
const hello = (processes: Machine.Hello["processes"] = []): Machine.Hello => ({
  type: "hello",
  protocol: 3,
  os: "linux",
  arch: "x64",
  home: "/home/worker",
  instance: Machine.Instance.make("a"),
  processes,
})
const count = (received: ReadonlyArray<Machine.ToWorker>, type: Machine.ToWorker["type"]) =>
  received.filter((message) => message.type === type).length

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
      yield* Effect.forEach(chunks, (chunk) => worker.runs[0].print(chunk))
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
      expect(count(worker.received, "start")).toBe(1)
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
      expect(count(worker.received, "start")).toBe(1)
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
      expect(count(worker.received, "start")).toBe(0)
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
      expect(count(worker.received, "start")).toBe(1)
    }),
  )

  it.effect("keeps the newest of two quick connections, with a start sent between them", () =>
    Effect.gen(function* () {
      const { worker, environment } = yield* connected
      const closeFirst = yield* worker.redial
      worker.drop("home", "started")
      const spawn = yield* Effect.forkChild(environment.spawner.spawn(command), { startImmediately: true })
      const closeSecond = yield* worker.redial
      const handle = yield* Fiber.join(spawn)
      yield* closeFirst
      yield* closeSecond
      const run = worker.runs[0]
      yield* run.print("ok")
      yield* run.exit(0)
      expect(yield* text(handle.all)).toBe("ok")
      expect(yield* handle.exitCode).toBe(ChildProcessSpawner.ExitCode(0))
      yield* environment.files.write("/work/newest.txt", bytes("newest"))
      expect(count(worker.received, "start")).toBe(1)
    }),
  )

  it.effect("sends a start only on the newest connection, wherever the spawn is paused", () =>
    Effect.forEach([0, 1, 2, 3], (pauses) =>
      Effect.gen(function* () {
        const machine = Machine.make(Environment.ID.make("gpu"))
        const late: Machine.ToWorker[] = []
        let replaced = false
        const dial = (send: Machine.Connection["send"]) =>
          Effect.forkChild(machine.connect({ hello: hello(), send, messages: Stream.never }), {
            startImmediately: true,
          })
        yield* dial((message) => replaced && late.push(message))
        // A scheduler that pauses the spawn every few steps, so the newer connection can arrive part-way through it.
        yield* Effect.forkChild(Effect.scoped(machine.environment.spawner.spawn(command)), {
          startImmediately: true,
        }).pipe(Effect.provideService(Scheduler.MaxOpsBeforeYield, 6))
        for (let index = 0; index < pauses; index++) yield* Effect.yieldNow
        replaced = true
        yield* dial(() => {})
        for (let index = 0; index < 50; index++) yield* Effect.yieldNow
        expect(late).toEqual([])
      }),
    ),
  )

  it.effect("ignores what a replaced connection still delivers, wherever its messages are paused", () =>
    Effect.forEach(
      Array.from({ length: 12 }, (_, index) => index),
      (pauses) =>
        Effect.gen(function* () {
          const machine = Machine.make(Environment.ID.make("gpu"))
          const messages = yield* Queue.unbounded<Exclude<Machine.FromWorker, Machine.Hello>>()
          const late: Machine.ToWorker[] = []
          const started: Machine.ProcessID[] = []
          let replaced = false
          // A scheduler that pauses the connection every few steps, so the newer one can arrive between two messages.
          yield* Effect.forkChild(
            machine.connect({
              hello: hello(),
              send: (message) => {
                if (message.type === "start") started.push(message.id)
                if (replaced) late.push(message)
              },
              messages: Stream.fromQueue(messages),
            }),
            { startImmediately: true },
          ).pipe(Effect.provideService(Scheduler.MaxOpsBeforeYield, 6))
          // Never closed, so the test's end does not wait for the process to stop.
          yield* Effect.forkChild(machine.environment.spawner.spawn(command).pipe(Scope.provide(yield* Scope.make())), {
            startImmediately: true,
          })
          const id = started[0]
          // One chunk, long enough that the paused connection handles it in several steps.
          Queue.offerAllUnsafe(messages, [
            { type: "started", id, pid: 7 },
            ...Array.from({ length: 30 }, (_, offset) => ({
              type: "output" as const,
              stream: "stdout" as const,
              id,
              offset,
              data: bytes("a"),
            })),
            { type: "exit", id, bytes: 30, code: 0 },
          ])
          for (let index = 0; index < pauses; index++) yield* Effect.yieldNow
          replaced = true
          yield* Effect.forkChild(
            machine.connect({
              hello: hello([{ id, pid: 7, state: "running", bytes: 0 }]),
              send: () => {},
              messages: Stream.never,
            }),
            { startImmediately: true },
          )
          for (let index = 0; index < 50; index++) yield* Effect.yieldNow
          expect(late).toEqual([])
        }),
    ),
  )

  it.effect("fails a running process as lost when the worker restarts", () =>
    Effect.gen(function* () {
      const { worker, environment } = yield* connected
      const handle = yield* environment.spawner.spawn(command)
      yield* worker.runs[0].print("partial")
      yield* worker.restart
      const lost = yield* handle.exitCode.pipe(Effect.flip)
      expect(cause(lost)).toBeInstanceOf(Machine.ProcessLost)
      expect(lost.message).toContain("gpu's worker restarted, the process was lost")
      expect(cause(yield* Stream.runDrain(handle.all).pipe(Effect.flip))).toBeInstanceOf(Machine.ProcessLost)
      expect(count(worker.received, "start")).toBe(1)
    }),
  )

  it.effect("releases a process once its exit is accepted, and only then", () =>
    Effect.gen(function* () {
      const { worker, environment } = yield* connected
      const finished = yield* environment.spawner.spawn(command)
      yield* environment.spawner.spawn(command)
      yield* worker.runs[0].exit(0)
      yield* finished.exitCode
      const released = worker.received.flatMap((message) => (message.type === "release" ? [message.id] : []))
      expect(released).toEqual([worker.runs[0].id])
    }),
  )

  it.effect("sends a lost release again on the next connection", () =>
    Effect.gen(function* () {
      const { worker, environment } = yield* connected
      const handle = yield* environment.spawner.spawn(command)
      worker.drop("worker", "release")
      yield* worker.runs[0].exit(0)
      yield* handle.exitCode
      yield* worker.cut
      yield* worker.restore
      // A worker still listing it would be told again on this connection.
      yield* worker.cut
      yield* worker.restore
      const released = worker.received.flatMap((message) => (message.type === "release" ? [message.id] : []))
      expect(released).toEqual([worker.runs[0].id])
    }),
  )

  it.effect("stops and releases a process whose scope closed while the machine was away", () =>
    Effect.gen(function* () {
      const machine = Machine.make(Environment.ID.make("gpu"))
      const worker = yield* makeWorker(machine)
      yield* worker.restore
      const scope = yield* Scope.make()
      yield* machine.environment.spawner.spawn(command).pipe(Scope.provide(scope))
      yield* worker.cut
      yield* Scope.close(scope, Exit.void)
      yield* worker.restore
      const id = worker.runs[0].id
      expect(worker.received.slice(1)).toEqual([
        { type: "kill", id, signal: "SIGKILL" },
        { type: "release", id },
      ])
      yield* worker.cut
      yield* worker.restore
      const link = machine.state()
      expect(link._tag === "Connected" && link.hello.processes).toEqual([])
    }),
  )

  it.effect("attaches to a running process it still tracks, without stopping it", () =>
    Effect.gen(function* () {
      const { worker, environment } = yield* connected
      yield* environment.spawner.spawn(command)
      yield* worker.cut
      yield* worker.restore
      expect(worker.received.map((message) => message.type)).toEqual(["start", "attach"])
    }),
  )

  it.effect("releases a process whose output is still being delivered only after its exit", () =>
    Effect.gen(function* () {
      const { worker, environment } = yield* connected
      const handle = yield* environment.spawner.spawn(command)
      const run = worker.runs[0]
      yield* run.print("a")
      yield* worker.cut
      yield* run.print("b")
      yield* run.exit(0)
      yield* worker.restore
      expect(yield* text(handle.all)).toBe("ab")
      expect(yield* handle.exitCode).toBe(ChildProcessSpawner.ExitCode(0))
      expect(worker.received.map((message) => message.type)).toEqual(["start", "attach", "release"])
    }),
  )

  it.effect("fails a process the same worker forgot before reconnecting, without saying it restarted", () =>
    Effect.gen(function* () {
      const { worker, environment } = yield* connected
      const handle = yield* environment.spawner.spawn(command)
      yield* worker.cut
      worker.forget(worker.runs[0].id)
      yield* worker.restore
      const lost = yield* handle.exitCode.pipe(Effect.flip)
      expect(cause(lost)).toBeInstanceOf(Machine.ProcessLost)
      expect(lost.message).toContain("gpu's worker no longer has the process")
      expect(lost.message).not.toContain("restarted")
    }),
  )

  it.effect("fails a process at once when the worker refuses to attach to it", () =>
    Effect.gen(function* () {
      const { worker, environment } = yield* connected
      const handle = yield* environment.spawner.spawn(command)
      yield* worker.cut
      worker.forgetAfterHello(worker.runs[0].id)
      yield* worker.restore
      expect(cause(yield* handle.exitCode.pipe(Effect.flip))).toBeInstanceOf(Machine.ProcessLost)
      expect(cause(yield* Stream.runDrain(handle.all).pipe(Effect.flip))).toBeInstanceOf(Machine.ProcessLost)
    }),
  )

  it.effect("ignores a refused kill of a process that already exited", () =>
    Effect.gen(function* () {
      const { worker, environment } = yield* connected
      const handle = yield* environment.spawner.spawn(command)
      worker.drop("home", "exit")
      yield* worker.runs[0].exit(3)
      const killing = yield* Effect.forkChild(handle.kill(), { startImmediately: true })
      yield* Effect.yieldNow
      expect(count(worker.received, "kill")).toBe(1)
      yield* worker.cut
      yield* worker.restore
      yield* Fiber.join(killing)
      expect(yield* handle.exitCode).toBe(ChildProcessSpawner.ExitCode(3))
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

  it.effect("sends a lost kill again on the next connection", () =>
    Effect.gen(function* () {
      const { worker, environment } = yield* connected
      const handle = yield* environment.spawner.spawn(command)
      worker.drop("worker", "kill")
      const killing = yield* Effect.forkChild(handle.kill(), { startImmediately: true })
      yield* worker.cut
      yield* worker.restore
      yield* Fiber.join(killing)
      expect(cause(yield* handle.exitCode.pipe(Effect.flip))).toBeInstanceOf(CrossSpawnSpawner.KilledBySignal)
      expect(count(worker.received, "start")).toBe(1)
    }),
  )

  it.effect("stops a process that ignores the first signal when its scope closes", () =>
    Effect.gen(function* () {
      const { worker, environment } = yield* connected
      const scope = yield* Scope.make()
      yield* environment.spawner
        .spawn(ChildProcess.make("/bin/sh", ["-c", "make"], { cwd: "/work", forceKillAfter: "3 seconds" }))
        .pipe(Scope.provide(scope))
      worker.runs[0].traps.add("SIGTERM")
      const closing = yield* Effect.forkChild(Scope.close(scope, Exit.void), { startImmediately: true })
      yield* Effect.yieldNow
      yield* TestClock.adjust("3 seconds")
      yield* Fiber.join(closing)
      const signals = worker.received.flatMap((message) => (message.type === "kill" ? [message.signal] : []))
      expect(signals).toEqual(["SIGTERM", "SIGKILL"])
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
      expect(count(worker.received, "kill")).toBe(0)
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
      expect([count(worker.received, "start"), count(worker.received, "fs")]).toEqual([1, 3])
    }),
  )

  it.effect("rejects inherited stdin at spawn", () =>
    Effect.gen(function* () {
      const { worker, environment } = yield* connected
      const error = yield* environment.spawner
        .spawn(ChildProcess.make("cat", [], { cwd: "/work", stdin: "inherit" }))
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

describe("machine stdio", () => {
  const ready = Effect.gen(function* () {
    const machine = Machine.make(Environment.ID.make("worker"))
    const worker = yield* makeWorker(machine)
    yield* worker.restore
    return { worker, environment: machine.environment }
  })

  it.effect("writes chunks with acknowledgments, splits large writes, and closes stdin", () =>
    Effect.gen(function* () {
      const { worker, environment } = yield* ready
      const handle = yield* environment.spawner.spawn(ChildProcess.make("cat", { cwd: "/work", stdin: "pipe" }))
      const large = new Uint8Array(65537).fill(65)
      yield* Stream.run(Stream.make(bytes("one"), large), handle.stdin)
      expect(worker.runs[0].input.map((data) => data.length)).toEqual([3, 65536, 1])
      expect(Buffer.concat(worker.runs[0].input)).toEqual(Buffer.concat([bytes("one"), large]))
      expect(worker.runs[0].inputClosed).toBe(true)
      const error = yield* Stream.run(Stream.make(bytes("late")), handle.stdin).pipe(Effect.flip)
      expect(error.message).toContain("Broken pipe")
      yield* worker.runs[0].exit(0)
      expect(yield* handle.exitCode).toBe(ChildProcessSpawner.ExitCode(0))
    }),
  )

  it.effect("supports configured streams without closing on done", () =>
    Effect.gen(function* () {
      const { worker, environment } = yield* ready
      const writer = yield* Deferred.make<Fiber.Fiber<unknown, unknown>>()
      const handle = yield* environment.spawner.spawn(
        ChildProcess.make("cat", {
          cwd: "/work",
          stdin: {
            stream: Stream.make(bytes("stream")).pipe(
              Stream.onStart(Effect.withFiber((fiber) => Deferred.succeed(writer, fiber))),
            ),
            endOnDone: false,
          },
        }),
      )
      yield* Fiber.join(yield* Deferred.await(writer))
      expect(worker.runs[0].input).toEqual([bytes("stream")])
      expect(worker.runs[0].inputClosed).toBe(false)
      yield* worker.runs[0].exit(0)
      expect(yield* handle.exitCode).toBe(ChildProcessSpawner.ExitCode(0))
    }),
  )

  it.effect("fails offline and unacknowledged input without resending after reconnect", () =>
    Effect.gen(function* () {
      const { worker, environment } = yield* ready
      const handle = yield* environment.spawner.spawn(ChildProcess.make("cat", { cwd: "/work", stdin: "pipe" }))
      worker.drop("home", "stdin")
      const writing = yield* Effect.forkChild(Stream.run(Stream.make(bytes("once"), bytes("never")), handle.stdin), {
        startImmediately: true,
      })
      expect(worker.runs[0].input).toEqual([bytes("once")])
      yield* worker.cut
      const unknown = yield* Fiber.join(writing).pipe(Effect.flip)
      expect(cause(unknown)).toBeInstanceOf(Machine.Unknown)
      expect(unknown.message).toContain("stdin operation's outcome is unknown")
      expect(cause(yield* Stream.run(Stream.make(bytes("offline")), handle.stdin).pipe(Effect.flip))).toBeInstanceOf(
        Machine.NotSent,
      )
      yield* worker.restore
      expect(count(worker.received, "stdin")).toBe(1)
      expect(count(worker.received, "start")).toBe(1)
      yield* worker.runs[0].exit(0)
      expect(yield* handle.exitCode).toBe(ChildProcessSpawner.ExitCode(0))
    }),
  )

  it.effect("stops a process when a source stream loses an unacknowledged write", () =>
    Effect.gen(function* () {
      const { worker, environment } = yield* ready
      worker.drop("home", "stdin")
      const handle = yield* environment.spawner.spawn(
        ChildProcess.make("cat", { cwd: "/work", stdin: Stream.make(bytes("once"), bytes("never")) }),
      )
      yield* Deferred.await(worker.runs[0].inputReceived)
      expect(worker.runs[0].input).toEqual([bytes("once")])
      yield* worker.cut
      yield* worker.restore
      const killed = cause(yield* handle.exitCode.pipe(Effect.flip))
      expect(killed).toBeInstanceOf(CrossSpawnSpawner.KilledBySignal)
      expect(killed instanceof CrossSpawnSpawner.KilledBySignal && killed.signal).toBe("SIGTERM")
      expect(yield* handle.isRunning).toBe(false)
      expect(worker.received.filter((message) => message.type === "kill")).toEqual([
        { type: "kill", id: worker.runs[0].id, signal: "SIGTERM" },
      ])
      expect(count(worker.received, "stdin")).toBe(1)
    }),
  )

  for (const failure of ["closed input", "source failure"]) {
    it.effect(`keeps a process running after ${failure}`, () =>
      Effect.gen(function* () {
        const { worker, environment } = yield* ready
        const release = yield* Deferred.make<void>()
        const writer = yield* Deferred.make<Fiber.Fiber<unknown, unknown>>()
        const sourceError = PlatformError.systemError({
          _tag: "Unknown",
          module: "Test",
          method: "source",
          description: "source failed",
        })
        const handle = yield* environment.spawner.spawn(
          ChildProcess.make("cat", {
            cwd: "/work",
            stdin: Stream.fromEffect(
              Deferred.await(release).pipe(
                Effect.andThen(
                  failure === "source failure" ? Effect.fail(sourceError) : Effect.succeed(bytes("input")),
                ),
              ),
            ).pipe(Stream.onStart(Effect.withFiber((fiber) => Deferred.succeed(writer, fiber)))),
          }),
        )
        if (failure === "closed input") worker.runs[0].inputClosed = true
        yield* Deferred.succeed(release, undefined)
        const error = yield* Fiber.join(yield* Deferred.await(writer)).pipe(Effect.flip)
        if (failure === "closed input") {
          expect(error).toBeInstanceOf(PlatformError.PlatformError)
          expect(String(error)).toContain("Broken pipe")
          expect(count(worker.received, "stdin")).toBe(1)
        }
        if (failure === "source failure") expect(error).toBe(sourceError)
        expect(count(worker.received, "kill")).toBe(0)
        expect(yield* handle.isRunning).toBe(true)
        yield* worker.runs[0].print("still running")
        yield* worker.runs[0].exit(0)
        expect(yield* text(handle.stdout)).toBe("still running")
        expect(yield* handle.exitCode).toBe(ChildProcessSpawner.ExitCode(0))
        expect(count(worker.received, "kill")).toBe(0)
      }),
    )
  }

  it.effect("the first output view allows its streams and rejects the other view", () =>
    Effect.gen(function* () {
      const { worker, environment } = yield* ready
      for (const view of ["separate", "merged"]) {
        const handle = yield* environment.spawner.spawn(command)
        const run = worker.runs[worker.runs.length - 1]
        yield* run.print("out")
        yield* run.print("err", "stderr")
        yield* run.exit(0)
        if (view === "separate") {
          expect(yield* text(handle.stdout)).toBe("out")
          expect(yield* text(handle.stderr)).toBe("err")
        }
        if (view === "merged") expect(yield* text(handle.all)).toBe("outerr")
        for (const rejected of view === "separate" ? [handle.all] : [handle.stdout, handle.stderr]) {
          const error = yield* text(rejected).pipe(Effect.flip)
          expect(error.reason._tag).toBe("BadArgument")
          expect(error.reason.description).toBe("read either all, or stdout and stderr, not both")
        }
      }
    }),
  )

  it.effect("keeps stream marks when replaying from a shared offset", () =>
    Effect.gen(function* () {
      const { worker, environment } = yield* ready
      const handle = yield* environment.spawner.spawn(command)
      const out = yield* Effect.forkChild(text(handle.stdout), { startImmediately: true })
      const err = yield* Effect.forkChild(text(handle.stderr), { startImmediately: true })
      yield* worker.runs[0].print("out")
      yield* worker.runs[0].print("err", "stderr")
      yield* worker.cut
      yield* worker.runs[0].print("offline-error", "stderr")
      yield* worker.runs[0].print("offline-out")
      yield* worker.restore
      yield* worker.runs[0].exit(0)
      expect(yield* Fiber.join(out)).toBe("outoffline-out")
      expect(yield* Fiber.join(err)).toBe("erroffline-error")
      expect(worker.received.filter((message) => message.type === "attach")).toEqual([
        { type: "attach", id: worker.runs[0].id, from: 6 },
      ])
    }),
  )

  it.effect("all keeps worker read order across reconnects", () =>
    Effect.gen(function* () {
      const { worker, environment } = yield* ready
      const handle = yield* environment.spawner.spawn(command)
      const all = yield* Effect.forkChild(text(handle.all), { startImmediately: true })
      yield* worker.runs[0].print("one", "stderr")
      yield* worker.runs[0].print("two")
      yield* worker.cut
      yield* worker.runs[0].print("three", "stderr")
      yield* worker.restore
      yield* worker.runs[0].exit(0)
      expect(yield* Fiber.join(all)).toBe("onetwothree")
    }),
  )
})

describe("machine wire", () => {
  it.effect("matches the shared v3 messages and requires explicit stdio fields", () =>
    Effect.sync(() => {
      for (const message of messages.to_worker)
        expect(
          Schema.encodeSync(Schema.fromJsonString(Machine.ToWorker))(
            Schema.decodeUnknownSync(Machine.ToWorker)(message),
          ),
        ).toBe(JSON.stringify(message))
      for (const message of messages.from_worker)
        expect(
          Schema.encodeSync(Schema.fromJsonString(Machine.FromWorker))(
            Schema.decodeUnknownSync(Machine.FromWorker)(message),
          ),
        ).toBe(JSON.stringify(message))
      expect(() =>
        Schema.decodeUnknownSync(Machine.ToWorker)({ type: "start", id: "p", argv: ["cat"], cwd: "/", env: {} }),
      ).toThrow()
      expect(() =>
        Schema.decodeUnknownSync(Machine.FromWorker)({ type: "output", id: "p", offset: 0, data: "" }),
      ).toThrow()
      expect(() => Schema.decodeUnknownSync(Machine.Hello)({ ...hello(), protocol: 1 })).toThrow()
    }),
  )

  it.effect("encodes bytes as base64 and decodes them back", () =>
    Effect.sync(() => {
      const id = Machine.ProcessID.make("p1")
      const output: Machine.FromWorker = { type: "output", id, offset: 0, stream: "stdout", data: bytes("hi") }
      const write: Machine.ToWorker = { type: "fs", req: 7, call: "write", path: "/a", bytes: bytes("hi") }
      const failed: Machine.FromWorker = { type: "failed", id, request: "attach", message: "unknown process" }
      const release: Machine.ToWorker = { type: "release", id }
      const json = JSON.parse(JSON.stringify(Schema.encodeSync(Machine.FromWorker)(output)))
      expect(json).toEqual({ type: "output", id: "p1", offset: 0, stream: "stdout", data: "aGk=" })
      expect(Schema.decodeUnknownSync(Machine.FromWorker)(json)).toEqual(output)
      expect(Schema.encodeSync(Machine.ToWorker)(write)).toEqual({ ...write, bytes: "aGk=" })
      expect(Schema.decodeUnknownSync(Machine.ToWorker)({ ...write, bytes: "aGk=" })).toEqual(write)
      expect(Schema.decodeUnknownSync(Machine.FromWorker)(JSON.parse(JSON.stringify(failed)))).toEqual(failed)
      expect(Schema.decodeUnknownSync(Machine.ToWorker)(JSON.parse(JSON.stringify(release)))).toEqual(release)
      expect(() => Schema.decodeUnknownSync(Machine.FromWorker)({ ...failed, request: "release" })).toThrow()
    }),
  )
})

environmentConformance("machine environment", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()
    const machine = Machine.make(Environment.ID.make("gpu"))
    const worker = yield* makeWorker(machine).pipe(Scope.provide(scope))
    yield* worker.restore
    return {
      files: machine.environment.files,
      root: `/workspace-${crypto.randomUUID()}`,
      symlink: worker.files.symlink,
      dispose: Scope.close(scope, Exit.void),
    }
  }),
)
