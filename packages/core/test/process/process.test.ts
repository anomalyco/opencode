import { describe, expect } from "bun:test"
import { realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { Effect, Exit, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { AppProcess } from "@opencode-ai/core/process"
import { testEffect } from "../lib/effect"

const it = testEffect(AppProcess.defaultLayer)

const NODE = process.execPath
const cmd = (...args: string[]) => ChildProcess.make(NODE, args)

describe("AppProcess", () => {
  describe("run", () => {
    it.effect(
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

    it.effect(
      "non-zero exit returns RunResult; caller can require success",
      Effect.gen(function* () {
        const svc = yield* AppProcess.Service
        const result = yield* svc.run(cmd("-e", "process.exit(1)"))
        expect(result.exitCode).toBe(1)
      }),
    )

    it.effect(
      "requireSuccess fails on non-zero exit",
      Effect.gen(function* () {
        const svc = yield* AppProcess.Service
        const exit = yield* Effect.exit(
          svc.run(cmd("-e", "process.exit(1)")).pipe(Effect.flatMap(AppProcess.requireSuccess)),
        )
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          const reason = exit.cause.reasons[0]
          if (reason && reason._tag === "Fail") {
            expect(reason.error).toBeInstanceOf(AppProcess.AppProcessError)
            expect((reason.error as AppProcess.AppProcessError).exitCode).toBe(1)
          } else {
            throw new Error("expected fail reason")
          }
        }
      }),
    )

    it.effect(
      "requireSuccess succeeds on exit 0",
      Effect.gen(function* () {
        const svc = yield* AppProcess.Service
        const result = yield* svc.run(cmd("-e", "process.exit(0)")).pipe(Effect.flatMap(AppProcess.requireSuccess))
        expect(result.exitCode).toBe(0)
      }),
    )

    it.effect(
      "requireExitIn allowlists multiple exit codes",
      Effect.gen(function* () {
        const svc = yield* AppProcess.Service
        const requireZeroOrOne = AppProcess.requireExitIn([0, 1])
        const okZero = yield* svc.run(cmd("-e", "process.exit(0)")).pipe(Effect.flatMap(requireZeroOrOne))
        expect(okZero.exitCode).toBe(0)
        const okOne = yield* svc.run(cmd("-e", "process.exit(1)")).pipe(Effect.flatMap(requireZeroOrOne))
        expect(okOne.exitCode).toBe(1)
        const exit = yield* Effect.exit(svc.run(cmd("-e", "process.exit(2)")).pipe(Effect.flatMap(requireZeroOrOne)))
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          const reason = exit.cause.reasons[0]
          if (reason && reason._tag === "Fail") {
            expect(reason.error).toBeInstanceOf(AppProcess.AppProcessError)
            expect((reason.error as AppProcess.AppProcessError).exitCode).toBe(2)
          }
        }
      }),
    )

    it.effect(
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

    it.effect(
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

    it.effect(
      "result includes command description",
      Effect.gen(function* () {
        const svc = yield* AppProcess.Service
        const result = yield* svc.run(cmd("-e", "process.stdout.write('hi')"))
        expect(result.command).toBe(`${NODE} -e process.stdout.write('hi')`)
      }),
    )
  })

  describe("inherited platform methods", () => {
    it.effect(
      "string returns stdout as string",
      Effect.gen(function* () {
        const svc = yield* AppProcess.Service
        const out = yield* svc.string(cmd("-e", "process.stdout.write('hi\\n')"))
        expect(out).toBe("hi\n")
      }),
    )

    it.effect(
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

    it.effect(
      "feeds a string to stdin and returns it on stdout",
      Effect.gen(function* () {
        const svc = yield* AppProcess.Service
        const result = yield* svc.run(cmd("-e", echoStdin), { stdin: "hello" })
        expect(result.exitCode).toBe(0)
        expect(result.stdout.toString("utf8")).toBe("hello")
      }),
    )

    it.effect(
      "feeds a Uint8Array to stdin",
      Effect.gen(function* () {
        const svc = yield* AppProcess.Service
        const bytes = new TextEncoder().encode("bytes")
        const result = yield* svc.run(cmd("-e", echoStdin), { stdin: bytes })
        expect(result.exitCode).toBe(0)
        expect(result.stdout.toString("utf8")).toBe("bytes")
      }),
    )

    it.effect(
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

    it.effect(
      "completes correctly with empty input",
      Effect.gen(function* () {
        const svc = yield* AppProcess.Service
        const result = yield* svc.run(cmd("-e", echoStdin), { stdin: "" })
        expect(result.exitCode).toBe(0)
        expect(result.stdout.toString("utf8")).toBe("")
      }),
    )

    it.effect(
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

    it.effect(
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
        const exit = yield* Effect.exit(
          svc
            .runStream(cmd("-e", "console.log('a'); process.exit(2)"), { okExitCodes: [0, 1] })
            .pipe(Stream.runCollect),
        )
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          const reason = exit.cause.reasons[0]
          if (reason && reason._tag === "Fail") {
            expect(reason.error).toBeInstanceOf(AppProcess.AppProcessError)
          }
        }
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
