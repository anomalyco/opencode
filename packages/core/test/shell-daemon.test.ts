import { describe, expect } from "bun:test"
import { existsSync, readdirSync, realpathSync } from "node:fs"
import { mkdir, rm, utimes, writeFile } from "node:fs/promises"
import path from "node:path"
import { Effect, Layer } from "effect"
import { TestClock } from "effect/testing"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { PersistentPty } from "@opencode/core/persistent-pty"
import { Config } from "@opencode/core/config"
import { Environment } from "@opencode/core/environment/index"
import { Location } from "@opencode/core/location"
import { AbsolutePath } from "@opencode/core/schema"
import { Shell } from "@opencode/core/shell"
import { Global } from "@opencode/util/global"
import { FSUtil } from "@opencode/util/fs-util"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { AppProcess } from "@opencode/util/process"
import { hostEnvironmentLayer } from "./fixture/environment"
import { location } from "./fixture/location"
import { daemonShells, until } from "./fixture/shell-daemon"
import { tmpdirScoped } from "./fixture/tmpdir"
import { binaryPath } from "@opencode/pty"
import { it } from "./lib/effect"

const unix = process.platform !== "win32"
const test = unix ? it.live : it.live.skip
// On the test clock, for timers.
const timed = unix ? it.effect : it.effect.skip

const lines = (count: number) => Array.from({ length: count }, (_, index) => `line ${index + 1}\n`).join("")

describe("Shell on the process daemon", () => {
  test("runs a command with the server's environment, an absolute cwd and its metadata", () =>
    Effect.gen(function* () {
      const env = yield* daemonShells()
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
              timeoutDeadline: expect.any(Number),
            },
          })
          expect(request?.env).toMatchObject({ TERM: "xterm-256color", OPENCODE_TERMINAL: "1" })
          expect(request?.env).not.toHaveProperty("OPENCODE_TEST_REMOVED")
          expect(request?.env).not.toHaveProperty("OPENCODE_TEST_UNSET")
          expect(info).toMatchObject({ status: "running", pid: 1001, cwd: path.join(env.directory, "sub") })
          expect(env.spawned()).toBe(0)

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
            capture: { output: "first\nsecond", truncated: false },
          })
          expect(yield* shell.list()).toEqual([])
        }),
      )
    }))

  test("counts lines like the spawner and reads only what reached the file after a write error", () =>
    Effect.gen(function* () {
      const env = yield* daemonShells()
      yield* env.withShell(env.directory, (shell) =>
        Effect.gen(function* () {
          const long = yield* shell.create({ shell: "/bin/sh", command: "long" })
          env.daemon.output(1, lines(3000))
          env.daemon.exit(1, 0)
          const result = yield* shell.result(long)
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
            },
          })

          // A single line longer than the window is sized from the file, which the daemon does not track.
          const wide = yield* shell.create({ shell: "/bin/sh", command: "wide" })
          env.daemon.output(3, `short\n${"x".repeat(60 * 1024)}\n`)
          env.daemon.exit(3, 0)
          expect((yield* shell.result(wide)).capture?.output).toEndWith(
            `\n\n[showing the last 50 KB of line 2 (60 KB); full output saved to ${wide.file}]`,
          )
        }),
      )
    }))

  test("bounds what it reads to number lines the daemon has not counted yet", () =>
    Effect.gen(function* () {
      const env = yield* daemonShells()
      yield* env.withShell(env.directory, (shell) =>
        Effect.gen(function* () {
          // Still running, so the daemon has not reported a line count, and the file is too big to count quickly.
          const big = yield* shell.create({ shell: "/bin/sh", command: "big" })
          env.daemon.output(1, `${"y".repeat(17 * 1024 * 1024)}\n${lines(10)}`)
          expect((yield* shell.result(big, { wait: 0 })).capture?.output).toEndWith(
            `line 10\n\n[showing the last 10 lines; full output saved to ${big.file}]`,
          )

          // A cut-off line that started too far back to look for.
          const wide = yield* shell.create({ shell: "/bin/sh", command: "wide" })
          env.daemon.output(2, `short\n${"x".repeat(2 * 1024 * 1024)}`)
          expect((yield* shell.result(wide, { wait: 0 })).capture?.output).toEndWith(
            `\n\n[showing the last 50 KB of line 2 (over 1024 KB); full output saved to ${wide.file}]`,
          )

          // The same, ending with a newline: the line's start is still too far back to know.
          const ended = yield* shell.create({ shell: "/bin/sh", command: "ended" })
          env.daemon.output(3, `short\n${"x".repeat(2 * 1024 * 1024)}\n`)
          expect((yield* shell.result(ended, { wait: 0 })).capture?.output).toEndWith(
            `\n\n[showing the last 50 KB of line 2 (over 1024 KB); full output saved to ${ended.file}]`,
          )
        }),
      )
    }))

  test("reports a command lost with the daemon as killed, with what it wrote", () =>
    Effect.gen(function* () {
      const env = yield* daemonShells()
      yield* env.withShell(env.directory, (shell) =>
        Effect.gen(function* () {
          const info = yield* shell.create({ shell: "/bin/sh", command: "work" })
          env.daemon.output(1, "partial\n")
          yield* until(() => env.daemon.waiters(1) > 0)
          env.daemon.drop(1)
          expect(yield* shell.result(info)).toMatchObject({
            info: { status: "killed" },
            capture: { output: "partial\n", killed: "Command was killed: the process daemon stopped" },
          })
        }),
      )
    }))

  test("stops what a failed command left in its group, and leaves a successful one's", () =>
    Effect.gen(function* () {
      const env = yield* daemonShells()
      yield* env.withShell(env.directory, (shell) =>
        Effect.gen(function* () {
          const succeeded = yield* shell.create({ shell: "/bin/sh", command: "serve & exit 0" })
          const failed = yield* shell.create({ shell: "/bin/sh", command: "serve & exit 3" })
          yield* until(() => env.daemon.waiters(1) > 0 && env.daemon.waiters(2) > 0)
          env.daemon.exit(1, 0)
          env.daemon.exit(2, 3)
          expect(yield* shell.wait(failed.id)).toMatchObject({ status: "exited", exit: 3 })
          expect(yield* shell.wait(succeeded.id)).toMatchObject({ status: "exited", exit: 0 })
          expect(env.signals(2)).toEqual(["SIGTERM"])
          expect(env.signals(1)).toEqual([])
        }),
      )
    }))

  test("fails a command the daemon rejected instead of spawning it", () =>
    Effect.gen(function* () {
      const env = yield* daemonShells()
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

  // On the test clock: the timeout and the grace period pass without waiting for them.
  timed("stops a timed-out command with SIGTERM, then SIGKILL after the grace period, and keeps it", () =>
    Effect.gen(function* () {
      const env = yield* daemonShells()
      env.daemon.trap.add(1)
      yield* env.withShell(env.directory, (shell) =>
        Effect.gen(function* () {
          const info = yield* shell.create({ shell: "/bin/sh", command: "trap '' TERM; sleep 60", timeout: 10 })
          yield* TestClock.adjust("10 millis")
          yield* until(() => env.signals(1).length > 0)
          expect(env.signals(1)).toEqual(["SIGTERM"])
          expect((yield* shell.get(info.id)).status).toBe("running")
          // The grace period starts once the daemon acknowledged SIGTERM, so keep the clock moving until it ends.
          yield* until(TestClock.adjust("1 second").pipe(Effect.map(() => env.signals(1).length > 1)))
          expect((yield* shell.wait(info.id)).status).toBe("timeout")
          expect(env.signals(1)).toEqual(["SIGTERM", "SIGKILL"])
          expect(env.daemon.processes[0]?.pipe?.metadata).toMatchObject({ stopReason: "timeout" })
          expect(env.daemon.processes[0]?.pipe?.metadata).not.toHaveProperty("timeoutDeadline")
          expect(yield* shell.result(info)).toMatchObject({
            info: { status: "timeout" },
            capture: { output: "(no output)" },
          })
          // Like a spawned command, it records how the stopped process ended.
          expect((yield* shell.result(info)).info).toMatchObject({ signal: "SIGKILL" })
          expect(env.daemon.ops).not.toContain("terminate")
          expect(existsSync(info.file)).toBe(true)
        }),
      )
    }),
  )

  test("forgets a command in the daemon before deleting its file, on remove and on eviction", () =>
    Effect.gen(function* () {
      const env = yield* daemonShells()
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
          // Waiters resolve before retention runs, which forgets the process and then deletes its file.
          yield* until(() => !existsSync(finished[0]!.file))
          expect(yield* shell.get(finished[0]!.id).pipe(Effect.flip)).toBeInstanceOf(Shell.NotFoundError)
          expect(existsSync(finished[0]!.file)).toBe(false)
          expect(env.daemon.processes.map((process) => process.id)).not.toContain(2)
          expect(existsSync(finished[1]!.file)).toBe(true)
        }),
      )
    }))

  test("takes its commands back after a restart and leaves other Locations' alone", () =>
    Effect.gen(function* () {
      const env = yield* daemonShells()
      env.daemon.trap.add(4)
      const before = yield* env.withShell(env.directory, (shell) =>
        Effect.gen(function* () {
          const running = yield* shell.create({ shell: "/bin/sh", command: "running", metadata: { tag: "a" } })
          const finished = yield* shell.create({ shell: "/bin/sh", command: "finished" })
          env.daemon.output(2, "done\n")
          env.daemon.exit(2, 3)
          const exited = yield* shell.wait(finished.id)
          const expiring = yield* shell.create({ shell: "/bin/sh", command: "expiring", timeout: 60_000 })
          const stopping = yield* shell.create({ shell: "/bin/sh", command: "stopping" })
          yield* shell.stop(stopping.id, "killed")
          yield* until(() => env.signals(4).length > 0)
          // A call waits on this one: a restart moves it to the background, so its timeout is not kept.
          const waited = yield* shell.create({ shell: "/bin/sh", command: "waited", timeout: 60_000, waited: true })
          return { running, exited, expiring, stopping, waited }
        }),
      )
      // Closing the Location only detached from its commands.
      expect(env.daemon.ops).not.toContain("terminate")
      expect(env.signals(1)).toEqual([])
      expect(env.signals(4)).toEqual(["SIGTERM"])
      // The expiring command's deadline passes while no server runs.
      const expiring = env.daemon.processes.find((process) => process.id === 3)?.pipe
      if (expiring) expiring.metadata = { ...expiring.metadata, timeoutDeadline: Date.now() - 1 }

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
          expect((yield* shell.result(before.exited)).capture).toMatchObject({ output: "done\n" })
          // The deadline passed during the restart, and the interrupted stop goes straight to SIGKILL.
          expect((yield* shell.wait(before.expiring.id)).status).toBe("timeout")
          expect(env.signals(3)).toEqual(["SIGTERM"])
          expect((yield* shell.wait(before.stopping.id)).status).toBe("killed")
          expect(env.signals(4)).toEqual(["SIGTERM", "SIGKILL"])

          expect(env.daemon.processes.find((process) => process.id === 5)?.pipe?.metadata).not.toHaveProperty(
            "timeoutDeadline",
          )
          expect((yield* shell.get(before.waited.id)).status).toBe("running")
          expect(env.signals(5)).toEqual([])

          env.daemon.exit(1, 0)
          expect(yield* shell.wait(before.running.id)).toMatchObject({ status: "exited", exit: 0 })
        }),
      )
    }))

  // A reload or an eviction closes a Location while the server keeps running.
  timed("a Location closed while the server runs keeps enforcing its commands' timeouts", () =>
    Effect.gen(function* () {
      const env = yield* daemonShells()
      const closing = yield* env.openLocation(env.directory)
      const info = yield* closing.shell.create({ shell: "/bin/sh", command: "sleep 60", timeout: 50 })
      yield* closing.close
      expect(env.signals(1)).toEqual([])
      yield* TestClock.adjust("50 millis")
      yield* until(() => env.signals(1).length > 0)
      expect(env.signals(1)).toEqual(["SIGTERM"])
      expect(yield* closing.shell.wait(info.id)).toMatchObject({ status: "timeout" })
    }),
  )

  timed("a closed Location and its replacement see the same commands, with one timer and one report each", () =>
    Effect.gen(function* () {
      const env = yield* daemonShells()
      const closing = yield* env.openLocation(env.directory)
      const backgrounded = yield* closing.shell.create({ shell: "/bin/sh", command: "sleep 60", timeout: 100 })
      const stopped = yield* closing.shell.create({ shell: "/bin/sh", command: "sleep 60" })
      const removed = yield* closing.shell.create({ shell: "/bin/sh", command: "sleep 60" })
      yield* closing.close
      let exits = 0
      yield* env.serverBus.listen((event) =>
        Effect.sync(() => {
          if (event.type === "shell.exited") exits++
        }),
      )
      const replacement = yield* env.openLocation(env.directory)
      expect((yield* replacement.shell.list()).map((item) => item.id)).toEqual([
        backgrounded.id,
        stopped.id,
        removed.id,
      ])

      // The call that started it, still in the closed Location, moves it to the background and clears its timeout.
      yield* closing.shell.timeout(backgrounded.id, 0)
      yield* TestClock.adjust("100 millis")
      expect(env.signals(1)).toEqual([])

      // Cancelling its job in the closed Location stops it; both see why it ended, and it is reported once.
      yield* closing.shell.stop(stopped.id, "killed")
      expect(yield* replacement.shell.wait(stopped.id)).toMatchObject({ status: "killed" })
      expect(yield* closing.shell.wait(stopped.id)).toMatchObject({ status: "killed" })
      yield* until(() => exits === 1)

      // Removed through one, it is gone from both.
      yield* replacement.shell.remove(removed.id)
      expect(yield* closing.shell.get(removed.id).pipe(Effect.flip)).toBeInstanceOf(Shell.NotFoundError)
      // The server watched them all along: the replacement took nothing back and waited on nothing more.
      expect(env.daemon.ops.filter((op) => op === "wait")).toHaveLength(3)
      yield* replacement.close
    }),
  )

  test("the sweep keeps a running command's file and forgets a finished one before deleting its file", () =>
    Effect.gen(function* () {
      const env = yield* daemonShells()
      const ids = yield* env.withShell(env.directory, (shell) =>
        Effect.gen(function* () {
          const running = yield* shell.create({ shell: "/bin/sh", command: "running" })
          const finished = yield* shell.create({ shell: "/bin/sh", command: "finished" })
          env.daemon.exit(2, 0)
          yield* shell.wait(finished.id)
          const lostFile = yield* shell.create({ shell: "/bin/sh", command: "lost file" })
          env.daemon.exit(3, 0)
          yield* shell.wait(lostFile.id)
          const old = yield* shell.create({ shell: "/bin/sh", command: "old" })
          env.daemon.exit(4, 0)
          yield* shell.wait(old.id)
          return { running, finished, lostFile, old }
        }),
      )
      // A finished process whose file was deleted elsewhere, and one that ended more than 7 days ago.
      yield* Effect.promise(() => rm(ids.lostFile.file))
      const ended = env.daemon.processes.find((process) => process.id === 4)
      if (ended) ended.exited_at = Date.now() - 8 * 24 * 60 * 60 * 1_000
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
      // The old process's file is recent, so it stays.
      expect(existsSync(ids.old.file)).toBe(true)
    }))
})

// Against the real opencode-pty, like server/test/persistent-pty.test.ts.
const binary = unix ? (process.env.OPENCODE_PTY_BIN ?? binaryPath) : undefined
const real = binary !== undefined && existsSync(binary) ? it.live : it.live.skip

describe("Shell on a real process daemon", () => {
  real(
    "starts the daemon on the first command, never on boot or sweep, and runs it with the server's environment",
    () =>
      Effect.gen(function* () {
        const data = (yield* tmpdirScoped()).path
        const directory = (yield* tmpdirScoped()).path
        const state = path.join(data, "state")
        const global = Global.layerWith({ data, state })
        const started = () => existsSync(path.join(state, "pty")) && readdirSync(path.join(state, "pty")).length > 0
        process.env.OPENCODE_TEST_REMOVED = "1"
        yield* Effect.addFinalizer(() => Effect.sync(() => delete process.env.OPENCODE_TEST_REMOVED))
        yield* Effect.gen(function* () {
          const shell = yield* Shell.Service
          yield* Shell.cleanup()
          expect(started()).toBe(false)
          const info = yield* shell.create(
            {
              shell: "/bin/sh",
              command: 'printf "%s|%s|%s\\n" "${OPENCODE_TEST_REMOVED:-unset}" "$TERM" "$(pwd)"; printf tail',
            },
            (invocation) =>
              Effect.sync(() => {
                delete invocation.env.OPENCODE_TEST_REMOVED
              }),
          )
          expect(started()).toBe(true)
          expect(yield* shell.result(info)).toMatchObject({
            info: { status: "exited", exit: 0 },
            capture: {
              output: `unset|xterm-256color|${realpathSync(directory)}\ntail`,
            },
          })
        }).pipe(
          Effect.scoped,
          Effect.provide(
            AppNodeBuilder.build(LayerNode.group([Shell.node, FSUtil.node, Global.node, PersistentPty.node]), [
              Location.node.replace(
                Layer.succeed(
                  Location.Service,
                  Location.Service.of(location(Location.Ref.make({ directory: AbsolutePath.make(directory) }))),
                ),
              ),
              Global.node.replace(global),
              Config.node.replace(Config.testLayer()),
              Environment.node.replace(hostEnvironmentLayer),
            ]),
          ),
        )
      }),
    { timeout: 20_000 },
  )
})
