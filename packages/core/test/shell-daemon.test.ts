import { describe, expect } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, utimes, writeFile } from "node:fs/promises"
import path from "node:path"
import { Context, Effect, Layer } from "effect"
import { ChildProcessSpawner } from "effect/process"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Config } from "@opencode/core/config"
import { Environment } from "@opencode/core/environment/index"
import { Location } from "@opencode/core/location"
import { PersistentPty } from "@opencode/core/persistent-pty"
import { AbsolutePath } from "@opencode/core/schema"
import { Shell } from "@opencode/core/shell"
import { Global } from "@opencode/util/global"
import { FSUtil } from "@opencode/util/fs-util"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { AppProcess } from "@opencode/util/process"
import { hostEnvironmentLayer } from "./fixture/environment"
import { location } from "./fixture/location"
import { fakeDaemon } from "./fixture/persistent-pty-daemon"
import { tmpdirScoped } from "./fixture/tmpdir"
import { it } from "./lib/effect"

const unix = process.platform !== "win32"
const test = unix ? it.live : it.live.skip

// One fake daemon and data directory shared by every Location (and server) a test builds.
const setup = Effect.fn(function* () {
  const daemon = yield* fakeDaemon()
  const data = (yield* tmpdirScoped()).path
  const global = Global.layerWith({ data, state: path.join(data, "state") })
  const context = yield* Layer.build(
    AppNodeBuilder.build(PersistentPty.configured(daemon.options), [Global.node.replace(global)]),
  )
  const pty = Context.get(context, PersistentPty.Service)
  let spawned = 0
  const environment = Layer.effect(
    Environment.Service,
    Effect.gen(function* () {
      const host = yield* Environment.Service
      return Environment.Service.of({
        ...host,
        spawner: ChildProcessSpawner.make(() =>
          Effect.sync(() => spawned++).pipe(Effect.andThen(Effect.die("the spawner must not be used"))),
        ),
      })
    }),
  ).pipe(Layer.provide(hostEnvironmentLayer))
  const shellLayer = (directory: string) =>
    AppNodeBuilder.build(Shell.node, [
      Location.node.replace(
        Layer.succeed(
          Location.Service,
          Location.Service.of(location(Location.Ref.make({ directory: AbsolutePath.make(directory) }))),
        ),
      ),
      Global.node.replace(global),
      Config.node.replace(Config.testLayer()),
      Environment.node.replace(environment),
      PersistentPty.node.replace(Layer.succeed(PersistentPty.Service, pty)),
    ])
  // Runs `body` against the Location's Shell, then closes it as a restart or an eviction would.
  const withShell = <A, E>(directory: string, body: (shell: Shell.Interface) => Effect.Effect<A, E>) =>
    Effect.scoped(
      Effect.gen(function* () {
        const shell = yield* Shell.Service
        return yield* body(shell)
      }).pipe(Effect.provide(shellLayer(directory))),
    )
  const directory = (yield* tmpdirScoped()).path
  return {
    daemon,
    data,
    directory,
    global,
    pty,
    withShell,
    spawned: () => spawned,
    created: () => daemon.requests.filter((request) => request.op === "create_pipe"),
    signals: (id: number) =>
      daemon.requests.flatMap((request) => (request.op === "signal" && request.id === id ? [request.signal] : [])),
  }
})

const lines = (count: number) => Array.from({ length: count }, (_, index) => `line ${index + 1}\n`).join("")

describe("Shell on the process daemon", () => {
  test("runs a command with the server's environment, an absolute cwd and its recovery metadata", () =>
    Effect.gen(function* () {
      const env = yield* setup()
      yield* Effect.promise(() => mkdir(path.join(env.directory, "sub")))
      process.env.OPENCODE_TEST_REMOVED = "1"
      yield* Effect.addFinalizer(() => Effect.sync(() => delete process.env.OPENCODE_TEST_REMOVED))
      yield* env.withShell(env.directory, (shell) =>
        Effect.gen(function* () {
          const info = yield* shell.create(
            {
              shell: "/bin/sh",
              command: "echo hi",
              cwd: "sub",
              timeout: 60_000,
              metadata: { sessionID: "ses_test" },
              toolCall: { sessionID: "ses_test", assistantMessageID: "msg_test", callID: "call_test" },
            },
            (invocation) =>
              Effect.sync(() => {
                delete invocation.env.OPENCODE_TEST_REMOVED
                invocation.env.OPENCODE_TEST_UNSET = undefined
              }),
          )
          const [request] = env.created()
          expect(request).toMatchObject({
            program: "/bin/sh",
            args: ["-c", "echo hi"],
            cwd: path.join(env.directory, "sub"),
            output_path: info.file,
            metadata: {
              id: info.id,
              command: "echo hi",
              shell: "/bin/sh",
              location: { directory: env.directory },
              metadata: { sessionID: "ses_test" },
              toolCall: { sessionID: "ses_test", assistantMessageID: "msg_test", callID: "call_test" },
              timeoutDeadline: expect.any(Number),
            },
          })
          expect(request?.env).toMatchObject({ TERM: "xterm-256color", OPENCODE_TERMINAL: "1" })
          expect(request?.env).not.toHaveProperty("OPENCODE_TEST_REMOVED")
          expect(request?.env).not.toHaveProperty("OPENCODE_TEST_UNSET")
          expect(info).toMatchObject({ status: "running", pid: 1001 })
          expect(shell.detachable(info.id)).toBe(true)
          expect(env.spawned()).toBe(0)
          expect(
            yield* shell.byToolCall({ sessionID: "ses_test", assistantMessageID: "msg_test", callID: "call_test" }),
          ).toMatchObject({ id: info.id })

          env.daemon.output(1, "first\nsecond")
          expect(yield* shell.output(info.id)).toEqual({
            output: "first\nsecond",
            cursor: 12,
            size: 12,
            truncated: false,
          })
          expect(yield* shell.output(info.id, { cursor: 6, limit: 3 })).toEqual({
            output: "sec",
            cursor: 9,
            size: 12,
            truncated: false,
          })
          expect(yield* shell.output(info.id, { cursor: Number.MAX_SAFE_INTEGER })).toEqual({
            output: "",
            cursor: 12,
            size: 12,
            truncated: false,
          })
          expect((yield* shell.list()).map((item) => item.id)).toEqual([info.id])

          env.daemon.exit(1, 0)
          expect(yield* shell.result(info)).toMatchObject({
            info: { status: "exited", exit: 0, time: { completed: expect.any(Number) } },
            capture: { output: "first\nsecond", truncated: false, lines: { shown: 2, total: 2 } },
          })
          expect(yield* shell.list()).toEqual([])
        }),
      )
    }))

  test("counts lines like the spawner and reads only what reached the file after a write error", () =>
    Effect.gen(function* () {
      const env = yield* setup()
      yield* env.withShell(env.directory, (shell) =>
        Effect.gen(function* () {
          const long = yield* shell.create({ shell: "/bin/sh", command: "long" })
          env.daemon.output(1, lines(3000))
          env.daemon.exit(1, 0)
          const result = yield* shell.result(long)
          expect(result.capture?.lines).toEqual({ shown: 2000, total: 3000 })
          expect(result.capture?.output).toEndWith(
            `line 3000\n\n[showing lines 1001-3000 of 3000; full output saved to ${long.file}]`,
          )

          const failed = yield* shell.create({ shell: "/bin/sh", command: "failed" })
          env.daemon.output(2, "kept\n")
          env.daemon.fail(2, "No space left on device")
          env.daemon.output(2, "lost\n")
          env.daemon.exit(2, 1)
          expect(yield* shell.result(failed)).toMatchObject({
            info: { status: "exited", exit: 1 },
            capture: {
              output: `kept\n\n\n[output file ${failed.file} stopped early: No space left on device]`,
              lines: { shown: 1, total: 1 },
            },
          })
        }),
      )
    }))

  test("fails a command the daemon rejected instead of spawning it", () =>
    Effect.gen(function* () {
      const env = yield* setup()
      env.daemon.failCreate.message = "output path is a symlink"
      yield* env.withShell(env.directory, (shell) =>
        Effect.gen(function* () {
          const error = yield* shell.create({ shell: "/bin/sh", command: "echo hi" }).pipe(Effect.flip)
          expect(error).toBeInstanceOf(AppProcess.AppProcessError)
          expect(env.spawned()).toBe(0)
          expect(yield* shell.list()).toEqual([])
        }),
      )
    }))

  test(
    "stops a timed-out command with SIGTERM, then SIGKILL after the grace period, and keeps it",
    () =>
      Effect.gen(function* () {
        const env = yield* setup()
        env.daemon.trap.add(1)
        yield* env.withShell(env.directory, (shell) =>
          Effect.gen(function* () {
            const info = yield* shell.create({ shell: "/bin/sh", command: "trap '' TERM; sleep 60", timeout: 10 })
            const started = Date.now()
            expect((yield* shell.wait(info.id)).status).toBe("timeout")
            expect(Date.now() - started).toBeGreaterThanOrEqual(2900)
            expect(env.signals(1)).toEqual(["SIGTERM", "SIGKILL"])
            expect(env.daemon.processes[0]?.pipe?.metadata).toMatchObject({ stopReason: "timeout" })
            expect(env.daemon.processes[0]?.pipe?.metadata).not.toHaveProperty("timeoutDeadline")
            expect(yield* shell.result(info)).toMatchObject({
              info: { status: "timeout" },
              capture: { output: "(no output)" },
            })
            expect((yield* shell.result(info)).info).not.toHaveProperty("signal")
            expect(env.daemon.ops).not.toContain("terminate")
            expect(existsSync(info.file)).toBe(true)
          }),
        )
      }),
    { timeout: 10_000 },
  )

  test("forgets a command in the daemon before deleting its file, on remove and on eviction", () =>
    Effect.gen(function* () {
      const env = yield* setup()
      yield* env.withShell(env.directory, (shell) =>
        Effect.gen(function* () {
          const running = yield* shell.create({ shell: "/bin/sh", command: "sleep 60" })
          yield* shell.remove(running.id)
          expect(env.daemon.requests.filter((request) => request.op === "terminate")).toEqual([
            expect.objectContaining({ id: 1 }),
          ])
          expect(existsSync(running.file)).toBe(false)
          expect(env.daemon.processes).toEqual([])
          expect(yield* shell.result(running)).toMatchObject({ info: { status: "killed" }, capture: undefined })

          const finished = yield* Effect.forEach(Array.from({ length: 26 }), (_, index) =>
            Effect.gen(function* () {
              const info = yield* shell.create({ shell: "/bin/sh", command: `echo ${index}` })
              env.daemon.exit(index + 2, 0)
              yield* shell.wait(info.id)
              return info
            }),
          )
          // Waiters resolve before retention runs.
          yield* Effect.sleep(20)
          expect(yield* shell.get(finished[0]!.id).pipe(Effect.flip)).toBeInstanceOf(Shell.NotFoundError)
          expect(existsSync(finished[0]!.file)).toBe(false)
          expect(env.daemon.processes.map((process) => process.id)).not.toContain(2)
          expect(existsSync(finished[1]!.file)).toBe(true)
        }),
      )
    }))

  test("takes its commands back after a restart and leaves other Locations' alone", () =>
    Effect.gen(function* () {
      const env = yield* setup()
      env.daemon.trap.add(4)
      const before = yield* env.withShell(env.directory, (shell) =>
        Effect.gen(function* () {
          const running = yield* shell.create({ shell: "/bin/sh", command: "running", metadata: { tag: "a" } })
          const finished = yield* shell.create({ shell: "/bin/sh", command: "finished" })
          env.daemon.output(2, "done\n")
          env.daemon.exit(2, 3)
          const exited = yield* shell.wait(finished.id)
          const expiring = yield* shell.create({ shell: "/bin/sh", command: "expiring", timeout: 100 })
          const stopping = yield* shell.create({ shell: "/bin/sh", command: "stopping" })
          yield* shell.stop(stopping.id, "killed")
          while (env.signals(4).length === 0) yield* Effect.sleep(5)
          return { running, exited, expiring, stopping }
        }),
      )
      // Closing the Location only detached from its commands.
      expect(env.daemon.ops).not.toContain("terminate")
      expect(env.signals(1)).toEqual([])
      expect(env.signals(4)).toEqual(["SIGTERM"])
      yield* Effect.sleep(150)

      const other = (yield* tmpdirScoped()).path
      yield* env.withShell(other, (shell) =>
        Effect.gen(function* () {
          expect(yield* shell.get(before.running.id).pipe(Effect.flip)).toBeInstanceOf(Shell.NotFoundError)
          expect(yield* shell.list()).toEqual([])
        }),
      )

      yield* env.withShell(env.directory, (shell) =>
        Effect.gen(function* () {
          expect(yield* shell.get(before.running.id)).toMatchObject({
            status: "running",
            command: "running",
            shell: "/bin/sh",
            file: before.running.file,
            metadata: { tag: "a" },
            pid: before.running.pid,
          })
          expect(yield* shell.get(before.exited.id)).toEqual({ ...before.exited, cwd: env.directory })
          expect((yield* shell.result(before.exited)).capture).toMatchObject({ output: "done\n", lines: { total: 1 } })
          // The deadline passed during the restart, and the interrupted stop goes straight to SIGKILL.
          expect((yield* shell.wait(before.expiring.id)).status).toBe("timeout")
          expect(env.signals(3)).toEqual(["SIGTERM"])
          expect((yield* shell.wait(before.stopping.id)).status).toBe("killed")
          expect(env.signals(4)).toEqual(["SIGTERM", "SIGKILL"])

          env.daemon.exit(1, 0)
          expect(yield* shell.wait(before.running.id)).toMatchObject({ status: "exited", exit: 0 })
        }),
      )
    }))

  test("records a command moved to the background at shutdown so the next server never times it out", () =>
    Effect.gen(function* () {
      const env = yield* setup()
      const info = yield* env.withShell(env.directory, (shell) =>
        Effect.gen(function* () {
          const info = yield* shell.create({ shell: "/bin/sh", command: "sleep 60", timeout: 100 })
          yield* shell.backgroundAtShutdown(info.id)
          return info
        }),
      )
      expect(env.daemon.processes[0]?.pipe?.metadata).toMatchObject({ backgroundedAtShutdown: true })
      expect(env.daemon.processes[0]?.pipe?.metadata).not.toHaveProperty("timeoutDeadline")
      yield* Effect.sleep(150)
      yield* env.withShell(env.directory, (shell) =>
        Effect.gen(function* () {
          yield* Effect.sleep(50)
          expect((yield* shell.get(info.id)).status).toBe("running")
          expect(env.signals(1)).toEqual([])
        }),
      )
    }))

  test("the sweep keeps a running command's file and forgets a finished one before deleting its file", () =>
    Effect.gen(function* () {
      const env = yield* setup()
      const ids = yield* env.withShell(env.directory, (shell) =>
        Effect.gen(function* () {
          const running = yield* shell.create({ shell: "/bin/sh", command: "running" })
          const finished = yield* shell.create({ shell: "/bin/sh", command: "finished" })
          env.daemon.exit(2, 0)
          yield* shell.wait(finished.id)
          return { running, finished }
        }),
      )
      const expired = new Date(Date.now() - 8 * 24 * 60 * 60 * 1_000)
      yield* Effect.promise(() => utimes(ids.running.file, expired, expired))
      yield* Effect.promise(() => utimes(ids.finished.file, expired, expired))
      const orphan = path.join(path.dirname(ids.running.file), "sh_0123456789abORPHANORPHANOR.out")
      yield* Effect.promise(() => writeFile(orphan, "orphan"))
      yield* Effect.promise(() => utimes(orphan, expired, expired))

      yield* Shell.cleanup().pipe(
        Effect.provide(
          AppNodeBuilder.build(LayerNode.group([FSUtil.node, Global.node, PersistentPty.node]), [
            Global.node.replace(env.global),
            PersistentPty.node.replace(Layer.succeed(PersistentPty.Service, env.pty)),
          ]),
        ),
      )

      expect(existsSync(ids.running.file)).toBe(true)
      expect(existsSync(ids.finished.file)).toBe(false)
      expect(existsSync(orphan)).toBe(false)
      expect(env.daemon.processes.map((process) => process.id)).toEqual([1])
    }))
})
