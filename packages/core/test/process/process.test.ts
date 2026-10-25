import { describe, expect } from "bun:test"
import fs from "fs/promises"
import { randomUUID } from "node:crypto"
import { realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Effect, Exit, Fiber, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { LayerNode } from "@bolt-ai/core/effect/layer-node"
import { AppProcess } from "@bolt-ai/core/process"
import { testEffect } from "../lib/effect"

// Every test spawns a real child, so all of them use the live clock. The spawner's 1s post-exit capture deadline
// never fires under TestClock, and a child whose close event arrives late would hang until the test timeout.
const it = testEffect(LayerNode.compile(AppProcess.node))

const NODE = process.execPath
const MISSING_CWD = path.join(tmpdir(), `opencode-missing-cwd-${randomUUID()}`)
const cmd = (...args: string[]) => ChildProcess.make(NODE, args)

// The child registers its SIGTERM handler before it announces readiness, and publishes the pid with a rename, so a
// test that signals it right after reading "ready" never races the handler or reads a partly written file.
const settleOnSigterm = (ready: string, settled: string) =>
  `const fs=require('fs');process.on('SIGTERM',()=>{fs.writeFileSync(${JSON.stringify(settled)},'settled');process.exit(0)});fs.writeFileSync(${JSON.stringify(ready + ".tmp")},String(process.pid));fs.renameSync(${JSON.stringify(ready + ".tmp")},${JSON.stringify(ready)});setInterval(()=>{},60000)`

const waitForFile = (file: string) =>
  Effect.promise(async () => {
    while (true) {
      try {
        const contents = await fs.readFile(file, "utf8")
        if (contents) return contents
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 10))
    }
  })

describe("AppProcess", () => {
  describe("run", () => {
    it.live(
      "captures stdout and exit code zero",
      Effect.gen(function* () {
        const svc = yield* AppProcess.Service
        const result = yield* svc.run(cmd("-e", "process.stdout.write('hi\\n')"))
        expect(result.exitCode).toBe(0)
        expect(result.stdout.toString("utf8")).toBe("hi\n")
        expect(result.stdoutTruncated).toBe(false)
        expect(result.stderrTruncated).toBe(false)
      }),
    )

    it.live(
      "maps command setup failures to AppProcessError",
      Effect.gen(function* () {
        const svc = yield* AppProcess.Service
        const error = yield* svc.run(ChildProcess.make(NODE, [], { cwd: MISSING_CWD })).pipe(Effect.flip)

        expect(error).toBeInstanceOf(AppProcess.AppProcessError)
        expect(error.command).toBe(NODE)
      }),
    )

    it.live(
      "captures stdout and stderr in emission order",
      Effect.gen(function* () {
        const svc = yield* AppProcess.Service
        const script = [
          'process.stdout.write("out 1\\n")',
          // Gaps wide enough that a busy test machine still reads each write before the next one.
          'setTimeout(() => process.stderr.write("err 1\\n"), 100)',
          'setTimeout(() => process.stdout.write("out 2\\n"), 200)',
        ].join(";")
        const result = yield* svc.run(cmd("-e", script), { combineOutput: true })
        expect(result.output?.toString("utf8")).toBe("out 1\nerr 1\nout 2\n")
        expect(result.stdout.toString("utf8")).toBe("")
        expect(result.stderr.toString("utf8")).toBe("")
      }),
    )

    it.live(
      "non-zero exit returns RunResult; caller can require success",
      Effect.gen(function* () {
        const svc = yield* AppProcess.Service
        const result = yield* svc.run(cmd("-e", "process.exit(1)"))
        expect(result.exitCode).toBe(1)
      }),
    )

    it.live(
      "requireSuccess fails on non-zero exit",
      Effect.gen(function* () {
        const svc = yield* AppProcess.Service
        const error = yield* svc
          .run(cmd("-e", "process.exit(1)"))
          .pipe(Effect.flatMap(AppProcess.requireSuccess), Effect.flip)
        expect(error).toBeInstanceOf(AppProcess.AppProcessError)
        expect(error.exitCode).toBe(1)
        expect(error.message).toContain("Command failed (exit 1)")
      }),
    )

    it.live(
      "requireSuccess succeeds on exit 0",
      Effect.gen(function* () {
        const svc = yield* AppProcess.Service
        const result = yield* svc.run(cmd("-e", "process.exit(0)")).pipe(Effect.flatMap(AppProcess.requireSuccess))
        expect(result.exitCode).toBe(0)
      }),
    )

    it.live(
      "requireExitIn allowlists multiple exit codes",
      Effect.gen(function* () {
        const svc = yield* AppProcess.Service
        const requireZeroOrOne = AppProcess.requireExitIn([0, 1])
        const okZero = yield* svc.run(cmd("-e", "process.exit(0)")).pipe(Effect.flatMap(requireZeroOrOne))
        expect(okZero.exitCode).toBe(0)
        const okOne = yield* svc.run(cmd("-e", "process.exit(1)")).pipe(Effect.flatMap(requireZeroOrOne))
        expect(okOne.exitCode).toBe(1)
        const error = yield* svc.run(cmd("-e", "process.exit(2)")).pipe(Effect.flatMap(requireZeroOrOne), Effect.flip)
        expect(error).toBeInstanceOf(AppProcess.AppProcessError)
        expect(error.exitCode).toBe(2)
      }),
    )

    it.live(
      "truncates stdout when maxOutputBytes is set",
      Effect.gen(function* () {
        const svc = yield* AppProcess.Service
        const result = yield* svc.run(cmd("-e", "process.stdout.write('0123456789')"), { maxOutputBytes: 5 })
        expect(result.exitCode).toBe(0)
        expect(result.stdoutTruncated).toBe(true)
        expect(result.stderrTruncated).toBe(false)
        expect(result.stdout.length).toBe(5)
        expect(result.stdout.toString("utf8")).toBe("01234")
      }),
    )

    it.live(
      "truncates stderr when maxErrorBytes is set",
      Effect.gen(function* () {
        const svc = yield* AppProcess.Service
        const result = yield* svc.run(cmd("-e", "process.stderr.write('0123456789')"), { maxErrorBytes: 5 })
        expect(result.exitCode).toBe(0)
        expect(result.stdoutTruncated).toBe(false)
        expect(result.stderrTruncated).toBe(true)
        expect(result.stderr.length).toBe(5)
        expect(result.stderr.toString("utf8")).toBe("01234")
      }),
    )

    it.live(
      "result includes command description",
      Effect.gen(function* () {
        const svc = yield* AppProcess.Service
        const result = yield* svc.run(cmd("-e", "process.stdout.write('hi')"))
        expect(result.command).toBe(`${NODE} -e process.stdout.write('hi')`)
      }),
    )

    if (process.platform !== "win32") {
      it.live(
        "timeout cleans up the scoped child process",
        Effect.acquireUseRelease(
          Effect.promise(() => fs.mkdtemp(path.join(tmpdir(), "bolt-process-timeout-"))),
          (directory) => {
            const ready = path.join(directory, "ready")
            const settled = path.join(directory, "settled")
            const script = settleOnSigterm(ready, settled)
            return Effect.gen(function* () {
              const svc = yield* AppProcess.Service
              const exit = yield* Effect.exit(svc.run(cmd("-e", script), { timeout: "250 millis" }))
              expect(Exit.isFailure(exit)).toBe(true)
              expect(yield* waitForFile(ready)).toMatch(/^\d+$/)
              expect(yield* waitForFile(settled)).toBe("settled")
            })
          },
          (directory) => Effect.promise(() => fs.rm(directory, { recursive: true, force: true })),
        ),
        5_000,
      )

      it.live(
        "fiber interruption cleans up the scoped child process after readiness",
        Effect.acquireUseRelease(
          Effect.promise(() => fs.mkdtemp(path.join(tmpdir(), "bolt-process-interrupt-"))),
          (directory) => {
            const ready = path.join(directory, "ready")
            const settled = path.join(directory, "settled")
            const script = settleOnSigterm(ready, settled)
            return Effect.gen(function* () {
              const svc = yield* AppProcess.Service
              const fiber = yield* svc.run(cmd("-e", script)).pipe(Effect.forkChild)
              expect(yield* waitForFile(ready)).toMatch(/^\d+$/)
              yield* Fiber.interrupt(fiber)
              expect(yield* waitForFile(settled)).toBe("settled")
            })
          },
          (directory) => Effect.promise(() => fs.rm(directory, { recursive: true, force: true })),
        ),
        5_000,
      )
    }
  })

  describe("inherited platform methods", () => {
    it.live(
      "string returns stdout as string",
      Effect.gen(function* () {
        const svc = yield* AppProcess.Service
        const out = yield* svc.string(cmd("-e", "process.stdout.write('hi\\n')"))
        expect(out).toBe("hi\n")
      }),
    )

    it.live(
      "lines returns the platform's array of lines",
      Effect.gen(function* () {
        const svc = yield* AppProcess.Service
        const out = yield* svc.lines(cmd("-e", "process.stdout.write('a\\nb\\n')"))
        expect(Array.from(out)).toEqual(["a", "b"])
      }),
    )
  })

  describe("run with stdin option", () => {
    const echoStdin = "process.stdin.on('data', c => process.stdout.write(c))"

    it.live(
      "feeds a string to stdin and returns it on stdout",
      Effect.gen(function* () {
        const svc = yield* AppProcess.Service
        const result = yield* svc.run(cmd("-e", echoStdin), { stdin: "hello" })
        expect(result.exitCode).toBe(0)
        expect(result.stdout.toString("utf8")).toBe("hello")
      }),
    )

    it.live(
      "feeds a Uint8Array to stdin",
      Effect.gen(function* () {
        const svc = yield* AppProcess.Service
        const bytes = new TextEncoder().encode("bytes")
        const result = yield* svc.run(cmd("-e", echoStdin), { stdin: bytes })
        expect(result.exitCode).toBe(0)
        expect(result.stdout.toString("utf8")).toBe("bytes")
      }),
    )

    it.live(
      "feeds a Stream of Uint8Array chunks to stdin",
      Effect.gen(function* () {
        const svc = yield* AppProcess.Service
        const enc = new TextEncoder()
        const stream = Stream.fromIterable([enc.encode("one"), enc.encode("-two"), enc.encode("-three")])
        const result = yield* svc.run(cmd("-e", echoStdin), { stdin: stream })
        expect(result.exitCode).toBe(0)
        expect(result.stdout.toString("utf8")).toBe("one-two-three")
      }),
    )

    it.live(
      "completes correctly with empty input",
      Effect.gen(function* () {
        const svc = yield* AppProcess.Service
        const result = yield* svc.run(cmd("-e", echoStdin), { stdin: "" })
        expect(result.exitCode).toBe(0)
        expect(result.stdout.toString("utf8")).toBe("")
      }),
    )

    it.live(
      "carries existing Command options like env",
      Effect.gen(function* () {
        const svc = yield* AppProcess.Service
        const script =
          "process.stdout.write(process.env.FEED + ':'); process.stdin.on('data', c => process.stdout.write(c))"
        const command = ChildProcess.make(NODE, ["-e", script], { env: { FEED: "envset" }, extendEnv: true })
        const result = yield* svc.run(command, { stdin: "payload" })
        expect(result.exitCode).toBe(0)
        expect(result.stdout.toString("utf8")).toBe("envset:payload")
      }),
    )

    it.live(
      "carries existing Command options like cwd",
      Effect.gen(function* () {
        const svc = yield* AppProcess.Service
        const dir = realpathSync(tmpdir())
        const script =
          "process.stdout.write(process.cwd() + '|'); process.stdin.on('data', c => process.stdout.write(c))"
        const command = ChildProcess.make(NODE, ["-e", script], { cwd: dir })
        const result = yield* svc.run(command, { stdin: "ok" })
        expect(result.exitCode).toBe(0)
        const [cwd, stdin] = result.stdout.toString("utf8").split("|")
        expect(realpathSync(cwd)).toBe(dir)
        expect(stdin).toBe("ok")
      }),
    )
  })

  describe("runStream", () => {
    it.live(
      "maps streaming command setup failures to AppProcessError",
      Effect.gen(function* () {
        const svc = yield* AppProcess.Service
        const error = yield* svc
          .runStream(ChildProcess.make(NODE, [], { cwd: MISSING_CWD }))
          .pipe(Stream.runCollect, Effect.flip)

        expect(error).toBeInstanceOf(AppProcess.AppProcessError)
        expect(error.command).toBe(NODE)
      }),
    )

    it.live(
      "emits lines incrementally and ends cleanly on exit 0",
      Effect.gen(function* () {
        const svc = yield* AppProcess.Service
        const result = yield* svc
          .runStream(cmd("-e", "console.log('one'); console.log('two'); console.log('three')"))
          .pipe(Stream.runCollect)
        expect(Array.from(result)).toEqual(["one", "two", "three"])
      }),
    )

    it.live(
      "okExitCodes determines whether a non-zero exit fails the stream",
      Effect.gen(function* () {
        const svc = yield* AppProcess.Service
        const allowed = yield* svc
          .runStream(cmd("-e", "console.log('only'); process.exit(1)"), { okExitCodes: [0, 1] })
          .pipe(Stream.runCollect)
        expect(Array.from(allowed)).toEqual(["only"])
        const error = yield* svc
          .runStream(cmd("-e", "console.log('a'); process.exit(2)"), { okExitCodes: [0, 1] })
          .pipe(Stream.runCollect, Effect.flip)
        expect(error).toBeInstanceOf(AppProcess.AppProcessError)
      }),
    )

    it.live(
      "includes stderr in output while retaining capped failure diagnostics",
      Effect.gen(function* () {
        const svc = yield* AppProcess.Service
        const lines: string[] = []
        const exit = yield* Effect.exit(
          svc
            .runStream(
              cmd(
                "-e",
                "console.log('stdout-line'); console.error('stderr-line'); console.error('diagnostic-tail'); process.exit(2)",
              ),
              { includeStderr: true, maxErrorBytes: 20, okExitCodes: [0] },
            )
            .pipe(Stream.runForEach((line) => Effect.sync(() => lines.push(line)))),
        )

        expect(lines.toSorted()).toEqual(["diagnostic-tail", "stderr-line", "stdout-line"])
        expect(Exit.isFailure(exit)).toBe(true)
        if (!Exit.isFailure(exit)) return
        const reason = exit.cause.reasons[0]
        expect(reason?._tag).toBe("Fail")
        if (!reason || reason._tag !== "Fail") return
        expect(reason.error).toBeInstanceOf(AppProcess.AppProcessError)
        expect(reason.error.stderr).toBe("stderr-line\ndiagnost")
      }),
    )

    it.live(
      "without okExitCodes, never fails on exit code",
      Effect.gen(function* () {
        const svc = yield* AppProcess.Service
        const result = yield* svc.runStream(cmd("-e", "console.log('only'); process.exit(7)")).pipe(Stream.runCollect)
        expect(Array.from(result)).toEqual(["only"])
      }),
    )

    it.live(
      "AbortSignal interrupts the stream",
      Effect.gen(function* () {
        const svc = yield* AppProcess.Service
        const controller = new AbortController()
        controller.abort()
        const exit = yield* Effect.exit(
          svc
            .runStream(cmd("-e", "setInterval(() => {}, 60_000)"), { signal: controller.signal })
            .pipe(Stream.runCollect),
        )
        expect(Exit.isFailure(exit)).toBe(true)
      }),
    )
  })

  describe("spawn (inherited)", () => {
    it.live(
      "returns the platform ChildProcessHandle for advanced use",
      Effect.scoped(
        Effect.gen(function* () {
          const svc = yield* AppProcess.Service
          const handle = yield* svc.spawn(cmd("-e", "setInterval(() => {}, 1_000)"))
          expect(yield* handle.isRunning).toBe(true)
          yield* handle.kill()
        }),
      ),
    )
  })
})
