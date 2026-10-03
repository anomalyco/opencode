import { describe, expect } from "bun:test"
import { Cause, Duration, Effect, Exit, Fiber, Layer, Option } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Config } from "@opencode-ai/core/config"
import { ConfigInteractive } from "@opencode-ai/core/config/interactive"
import { ConfigToolOutput } from "@opencode-ai/core/config/tool-output"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { InteractiveGovernor } from "@opencode-ai/core/tool/interactive/governor"
import { InteractiveJob } from "@opencode-ai/core/tool/interactive/job"
import { InteractiveLedger } from "@opencode-ai/core/tool/interactive/ledger"
import { InteractiveProcess } from "@opencode-ai/core/tool/interactive/runtime"
import { InteractiveSpool } from "@opencode-ai/core/tool/interactive/spool"
import { InteractiveJobs } from "@opencode-ai/core/tool/interactive/store"
import path from "path"
import { configLayer } from "./fixture/config"
import { fakeProcess, type FakeOptions, type FakeRuntime } from "./fixture/interactive-process"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const sessionID = SessionV2.ID.make("ses_interactive_store")
const otherSessionID = SessionV2.ID.make("ses_interactive_other")

interface Services {
  readonly jobs: InteractiveJobs.Interface
  readonly spool: InteractiveSpool.Interface
  readonly governor: InteractiveGovernor.Interface
  readonly ledger: InteractiveLedger.Interface
  readonly runtime: FakeRuntime
  readonly dataDir: string
}

const withJobs = <A, E, R>(
  body: (services: Services) => Effect.Effect<A, E, R>,
  options: {
    readonly interactive?: ConfigInteractive.Info
    readonly tool_output?: ConfigToolOutput.Info
    readonly runtime?: FakeOptions
  } = {},
) =>
  Effect.acquireUseRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => {
      const runtime = fakeProcess(options.runtime)
      const graph = AppNodeBuilder.build(
        LayerNode.group([
          InteractiveJobs.node,
          InteractiveSpool.node,
          InteractiveLedger.node,
          InteractiveGovernor.node,
          FSUtil.node,
        ]),
        [
          [Location.node, Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(tmp.path) })))],
          [Global.node, Global.layerWith({ data: tmp.path })],
          [
            Config.node,
            configLayer({
              ...(options.interactive ? { interactive: options.interactive } : {}),
              ...(options.tool_output ? { tool_output: options.tool_output } : {}),
            }),
          ],
          [InteractiveProcess.node, runtime.layer],
        ],
      )
      return Effect.gen(function* () {
        return yield* body({
          jobs: yield* InteractiveJobs.Service,
          spool: yield* InteractiveSpool.Service,
          governor: yield* InteractiveGovernor.Service,
          ledger: yield* InteractiveLedger.Service,
          runtime,
          dataDir: tmp.path,
        })
      }).pipe(Effect.provide(graph))
    },
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  )

/** Runs the effect into a typed-error value so model-facing errors are assertable. */
const failWith = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(effect)
    if (!Exit.isFailure(exit)) return yield* Effect.die("expected the effect to fail")
    return Option.getOrUndefined(Cause.findErrorOption(exit.cause))
  })

const quiet = new ConfigInteractive.Info({ quiet_window_ms: 40 })
const chunk = (maxBytes: number) => new ConfigToolOutput.Info({ max_lines: 10_000, max_bytes: maxBytes })

/**
 * Boots the job stack against a FIXED data directory (instead of a fresh
 * tmpdir), so several boots can share one ledger file — used by the startup
 * sweep test (spec R30/I9).
 */
const withJobsOn = <A, E, R>(data: string, body: (services: Services) => Effect.Effect<A, E, R>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const runtime = fakeProcess()
      const graph = AppNodeBuilder.build(
        LayerNode.group([
          InteractiveJobs.node,
          InteractiveSpool.node,
          InteractiveLedger.node,
          InteractiveGovernor.node,
          FSUtil.node,
        ]),
        [
          [Location.node, Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(data) })))],
          [Global.node, Global.layerWith({ data })],
          [Config.node, configLayer()],
          [InteractiveProcess.node, runtime.layer],
        ],
      )
      return yield* Effect.gen(function* () {
        return yield* body({
          jobs: yield* InteractiveJobs.Service,
          spool: yield* InteractiveSpool.Service,
          governor: yield* InteractiveGovernor.Service,
          ledger: yield* InteractiveLedger.Service,
          runtime,
          dataDir: data,
        })
      }).pipe(Effect.provide(graph))
    }),
  )

/** POSIX process-group leader that dies on SIGTERM; for ledger sweep assertions. */
const spawnSleeper = () => {
  const proc = Bun.spawn({ cmd: ["setsid", "sleep", "30"] })
  return { pgid: proc.pid, exited: Effect.promise(() => proc.exited.then(() => undefined)) }
}

const it = testEffect(Layer.empty)

describe("InteractiveJobs", () => {
  if (process.platform !== "win32") {
    it.live("booting the store layer sweeps ledger-recorded orphans before the first spawn (spec R30/I9)", () =>
      Effect.acquireUseRelease(
        Effect.promise(() => tmpdir()),
        (tmp) =>
          Effect.gen(function* () {
            // boot 1: record a live process group into the ledger, then close
            const orphan = yield* withJobsOn(tmp.path, ({ ledger }) =>
              Effect.gen(function* () {
                const sleeper = spawnSleeper()
                yield* ledger.record({ jobID: "ijob_orphan", sessionID, pgid: sleeper.pgid, startedAt: Date.now() })
                return sleeper
              }),
            )
            // boot 2: the layer build must reap the orphan before any spawn
            yield* withJobsOn(tmp.path, ({ jobs, ledger }) =>
              Effect.gen(function* () {
                // the boot sweep already dropped the rows
                expect(yield* ledger.sweep()).toBe(0)
                const started = yield* jobs.start({ sessionID, command: "one" })
                expect(started.status).toBe("waiting")
                yield* jobs.killAll({ reason: "session-close" })
              }),
            )
            // the orphan died by SIGTERM from the boot sweep
            yield* Effect.race(
              orphan.exited,
              Effect.sleep(Duration.seconds(3)).pipe(Effect.andThen(Effect.die("orphan was not reaped by the boot sweep"))),
            )
          }),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      ))
  }

  it.live("start settles waiting at quiescence with ascending ijob_ ids and full budget state", () =>
    withJobs(
      ({ jobs, runtime, dataDir }) =>
        Effect.gen(function* () {
          const first = yield* jobs.start({ sessionID, command: "gdb ./a.out" })
          expect(first.jobID.startsWith("ijob_")).toBe(true)
          expect(first.status).toBe("waiting")
          expect(first.output).toBe("gdb banner\n> ")
          expect(first.truncated).toBe(false)
          expect(first.exit).toBeUndefined()
          expect(first.reason).toBeUndefined()
          expect(first.exchanges).toBe(1)
          expect(first.exchangesRemaining).toBe(19)
          expect(first.outputPath.startsWith(path.join(dataDir, "tool-output", "tool_ijob_"))).toBe(true)
          expect(runtime.spawned).toHaveLength(1)
          expect(runtime.spawned[0]).toMatchObject({ command: "gdb ./a.out", cwd: dataDir })
          expect(runtime.spawned[0]?.child.exited).toBe(false)

          const second = yield* jobs.start({ sessionID, command: "python3 -i" })
          expect(second.jobID.startsWith("ijob_")).toBe(true)
          expect(second.jobID > first.jobID).toBe(true)

          yield* jobs.killAll({ reason: "session-close" })
        }),
      { interactive: quiet, runtime: { schedule: [{ bytes: "gdb banner\n> ", delayMs: 4 }] } },
    ))

  it.live("start enforces interactive.max_jobs and names the live jobs", () =>
    withJobs(
      ({ jobs }) =>
        Effect.gen(function* () {
          const first = yield* jobs.start({ sessionID, command: "one" })
          const second = yield* jobs.start({ sessionID, command: "two" })
          const error = yield* failWith(jobs.start({ sessionID, command: "three" }))
          expect(error?._tag).toBe("InteractiveGovernor.TooManyJobsError")
          if (error?._tag === "InteractiveGovernor.TooManyJobsError")
            expect(error.liveJobIDs).toEqual([first.jobID, second.jobID])

          yield* jobs.killAll({ reason: "session-close" })
        }),
      { interactive: new ConfigInteractive.Info({ quiet_window_ms: 40, max_jobs: 2 }) },
    ))

  it.live("start settles done at the exit boundary even before the quiet window elapses", () =>
    withJobs(
      ({ jobs }) =>
        Effect.gen(function* () {
          const result = yield* jobs.start({ sessionID, command: "./quick" })
          expect(result.status).toBe("done")
          expect(result.exit).toBe(0)
          expect(result.output).toBe("bye\n")
          expect(result.exchanges).toBe(1)
        }),
      {
        interactive: new ConfigInteractive.Info({ quiet_window_ms: 100 }),
        runtime: { schedule: [{ bytes: "bye\n", delayMs: 5 }, { exit: 0, delayMs: 10 }] },
      },
    ))

  it.live("start settles failed when spawn fails, with the message in the output", () =>
    withJobs(
      ({ jobs, runtime }) =>
        Effect.gen(function* () {
          const result = yield* jobs.start({ sessionID, command: "./missing" })
          expect(result.status).toBe("failed")
          expect(result.output).toContain("spawn ENOENT")
          expect(result.exchanges).toBe(1)
          expect(runtime.spawned).toHaveLength(0)
        }),
      { interactive: quiet, runtime: { failSpawn: new Error("spawn ENOENT") } },
    ))

  it.live("write feeds exact stdin bytes and returns the new output; quit exits the job", () =>
    withJobs(
      ({ jobs, runtime }) =>
        Effect.gen(function* () {
          const started = yield* jobs.start({ sessionID, command: "./repl" })
          const child = runtime.spawned[0]?.child
          expect(started.status).toBe("waiting")

          const echoed = yield* jobs.write({ sessionID, jobID: started.jobID, input: "break main\n" })
          expect(echoed.status).toBe("waiting")
          expect(echoed.output).toBe("got: break main\n")
          expect(echoed.exchanges).toBe(2)
          expect(child?.writes).toEqual(["break main\n"])

          const quit = yield* jobs.write({ sessionID, jobID: started.jobID, input: "quit\n" })
          expect(quit.status).toBe("done")
          expect(quit.exit).toBe(0)
          expect(quit.output).toBe("")
          expect(quit.exchanges).toBe(3)
          expect(child?.writes).toEqual(["break main\n", "quit\n"])
        }),
      {
        interactive: quiet,
        runtime: {
          schedule: [{ bytes: "repl> ", delayMs: 4 }],
          respond: (input) => (input === "quit\n" ? { exit: 0 } : { bytes: `got: ${input}` }),
        },
      },
    ))

  it.live("write with empty input and no eof fails as EmptyWriteError", () =>
    withJobs(
      ({ jobs }) =>
        Effect.gen(function* () {
          const started = yield* jobs.start({ sessionID, command: "./repl" })
          const error = yield* failWith(jobs.write({ sessionID, jobID: started.jobID, input: "" }))
          expect(error?._tag).toBe("InteractiveJobs.EmptyWriteError")

          yield* jobs.killAll({ reason: "session-close" })
        }),
      { interactive: quiet },
    ))

  it.live("write with eof: true signals end-of-input and accepts empty input", () =>
    withJobs(
      ({ jobs, runtime }) =>
        Effect.gen(function* () {
          const started = yield* jobs.start({ sessionID, command: "./repl" })
          const child = runtime.spawned[0]?.child

          const emptyEof = yield* jobs.write({ sessionID, jobID: started.jobID, input: "", eof: true })
          expect(emptyEof.status).toBe("waiting")
          expect(child?.eofs).toHaveLength(1)

          const lastEof = yield* jobs.write({ sessionID, jobID: started.jobID, input: "last\n", eof: true })
          expect(lastEof.status).toBe("waiting")
          expect(child?.eofs).toHaveLength(2)
          expect(child?.writes).toEqual(["last\n"])

          yield* jobs.killAll({ reason: "session-close" })
        }),
      { interactive: quiet },
    ))

  it.live("write to a terminal job fails naming the terminal status and outputPath", () =>
    withJobs(
      ({ jobs }) =>
        Effect.gen(function* () {
          const started = yield* jobs.start({ sessionID, command: "./quick" })
          expect(started.status).toBe("done")

          const error = yield* failWith(jobs.write({ sessionID, jobID: started.jobID, input: "late\n" }))
          expect(error?._tag).toBe("InteractiveJobs.TerminalJobError")
          if (error?._tag === "InteractiveJobs.TerminalJobError") {
            expect(error.status).toBe("done")
            expect(error.outputPath).toBe(started.outputPath)
          }
        }),
      {
        interactive: quiet,
        runtime: { schedule: [{ bytes: "bye\n", delayMs: 2 }, { exit: 0, delayMs: 4 }] },
      },
    ))

  it.live("write to an unknown job or another session's job fails as unknown job", () =>
    withJobs(
      ({ jobs }) =>
        Effect.gen(function* () {
          const unknown = yield* failWith(jobs.write({ sessionID, jobID: "ijob_missing", input: "hi\n" }))
          expect(unknown?._tag).toBe("InteractiveJobs.UnknownJobError")

          const started = yield* jobs.start({ sessionID, command: "./repl" })
          const foreign = yield* failWith(jobs.write({ sessionID: otherSessionID, jobID: started.jobID, input: "hi\n" }))
          expect(foreign?._tag).toBe("InteractiveJobs.UnknownJobError")

          yield* jobs.killAll({ reason: "session-close" })
        }),
      { interactive: quiet },
    ))

  it.live("a second call while one is in flight fails fast naming the in-flight call", () =>
    withJobs(
      ({ jobs }) =>
        Effect.gen(function* () {
          const started = yield* jobs.start({ sessionID, command: "./repl" })
          const slow = yield* Effect.forkChild(jobs.write({ sessionID, jobID: started.jobID, input: "slow\n" }))
          const busy = yield* failWith(jobs.write({ sessionID, jobID: started.jobID, input: "second\n" }))
          expect(busy?._tag).toBe("InteractiveJobs.BusyJobError")
          if (busy?._tag === "InteractiveJobs.BusyJobError") expect(busy.call).toContain("write")

          const slowExit = yield* Fiber.await(slow)
          if (!Exit.isSuccess(slowExit)) return yield* Effect.die("expected the slow write to settle")
          expect(slowExit.value.status).toBe("waiting")
          expect(slowExit.value.exchanges).toBe(2)
        }),
      { interactive: quiet },
    ))

  it.live("wait blocks until exit and returns the final result with the exit code", () =>
    withJobs(
      ({ jobs }) =>
        Effect.gen(function* () {
          const started = yield* jobs.start({ sessionID, command: "./build" })
          expect(started.status).toBe("waiting")

          const final = yield* jobs.wait({ sessionID, jobID: started.jobID, timeout: 2000 })
          expect(final.status).toBe("failed")
          expect(final.exit).toBe(3)
          expect(final.output).toBe("")
          expect(final.exchanges).toBe(2)
        }),
      {
        interactive: quiet,
        runtime: { schedule: [{ bytes: "working\n", delayMs: 5 }, { exit: 3, delayMs: 80 }] },
      },
    ))

  it.live("wait deadline yields timeout while the process stays alive", () =>
    withJobs(
      ({ jobs, runtime }) =>
        Effect.gen(function* () {
          const started = yield* jobs.start({ sessionID, command: "./hang" })
          const timedOut = yield* jobs.wait({ sessionID, jobID: started.jobID, timeout: 60 })
          expect(timedOut.status).toBe("timeout")
          expect(timedOut.exit).toBeUndefined()

          expect(runtime.spawned[0]?.child.exited).toBe(false)
          const stillAlive = yield* jobs.write({ sessionID, jobID: started.jobID, input: "ping\n" })
          expect(stillAlive.status).toBe("waiting")

          yield* jobs.killAll({ reason: "session-close" })
        }),
      {
        interactive: quiet,
        runtime: { schedule: [{ bytes: "idle\n", delayMs: 4 }], respond: (input) => ({ bytes: `got: ${input}` }) },
      },
    ))

  it.live("wait replays an already-terminal job idempotently with empty new output", () =>
    withJobs(
      ({ jobs }) =>
        Effect.gen(function* () {
          const started = yield* jobs.start({ sessionID, command: "./quick" })
          expect(started.status).toBe("done")
          expect(started.output).toBe("bye\n")

          const replay = yield* jobs.wait({ sessionID, jobID: started.jobID })
          expect(replay.status).toBe("done")
          expect(replay.exit).toBe(0)
          expect(replay.output).toBe("")
          expect(replay.exchanges).toBe(2)
        }),
      {
        interactive: quiet,
        runtime: { schedule: [{ bytes: "bye\n", delayMs: 2 }, { exit: 0, delayMs: 4 }] },
      },
    ))

  it.live("cancel kills the job and returns cancelled with reason model without consuming an exchange", () =>
    withJobs(
      ({ jobs, runtime }) =>
        Effect.gen(function* () {
          const started = yield* jobs.start({ sessionID, command: "./hang" })
          expect(started.status).toBe("waiting")

          const cancelled = yield* jobs.cancel({ sessionID, jobID: started.jobID })
          expect(cancelled.status).toBe("cancelled")
          expect(cancelled.reason).toBe("model")
          expect(cancelled.exit).toBeUndefined()
          expect(cancelled.exchanges).toBe(1)
          expect(runtime.spawned[0]?.child.exited).toBe(true)
          expect(runtime.spawned[0]?.child.kills).toHaveLength(1)
        }),
      { interactive: quiet, runtime: { schedule: [{ bytes: "started\n", delayMs: 4 }] } },
    ))

  it.live("cancel is idempotent on a terminal job and returns the existing terminal status", () =>
    withJobs(
      ({ jobs }) =>
        Effect.gen(function* () {
          const started = yield* jobs.start({ sessionID, command: "./quick" })
          expect(started.status).toBe("done")

          const again = yield* jobs.cancel({ sessionID, jobID: started.jobID })
          expect(again.status).toBe("done")
          expect(again.exit).toBe(0)
          expect(again.reason).toBeUndefined()
        }),
      {
        interactive: quiet,
        runtime: { schedule: [{ bytes: "bye\n", delayMs: 2 }, { exit: 0, delayMs: 4 }] },
      },
    ))

  it.live("a truncated chunk is not re-delivered and the tail stays available via the spool", () =>
    withJobs(
      ({ jobs, spool, runtime }) =>
        Effect.gen(function* () {
          const started = yield* jobs.start({ sessionID, command: "./flood" })
          expect(started.status).toBe("waiting")
          expect(started.output).toBe("")
          const jobID = InteractiveJob.ID.ascending(started.jobID)
          const child = runtime.spawned[0]?.child
          if (!child) return yield* Effect.die("expected the fake child to spawn")

          const burst = "A".repeat(150)
          yield* child.emit(burst)
          const cut = yield* jobs.write({ sessionID, jobID: started.jobID, input: "x\n" })
          expect(cut.status).toBe("running")
          expect(cut.truncated).toBe(true)
          expect(cut.output).toBe("A".repeat(100))

          const tail = "T".repeat(80)
          yield* child.emit(tail)
          const next = yield* jobs.write({ sessionID, jobID: started.jobID, input: "y\n" })
          expect(next.status).toBe("waiting")
          expect(next.truncated).toBe(false)
          expect(next.output).toBe(tail)

          const whole = yield* spool.slice(jobID, 0, undefined, { maxLines: 1000, maxBytes: 100_000 })
          expect(whole.text).toBe(burst + tail)
          expect(whole.truncated).toBe(false)
          expect(whole.nextCursor).toBe(Buffer.byteLength(burst + tail))
          const paged = yield* spool.slice(jobID, 150, undefined, { maxLines: 1000, maxBytes: 100_000 })
          expect(paged.text).toBe(tail)

          yield* jobs.killAll({ reason: "session-close" })
        }),
      { interactive: quiet, tool_output: chunk(100) },
    ))

  it.live("exchange budget exhaustion auto-cancels with reason exchanges and the spool path", () =>
    withJobs(
      ({ jobs }) =>
        Effect.gen(function* () {
          const started = yield* jobs.start({ sessionID, command: "./repl" })
          expect(started.exchangesRemaining).toBe(1)

          const second = yield* jobs.write({ sessionID, jobID: started.jobID, input: "a\n" })
          expect(second.status).toBe("waiting")
          expect(second.exchanges).toBe(2)
          expect(second.exchangesRemaining).toBe(0)

          const exhausted = yield* jobs.write({ sessionID, jobID: started.jobID, input: "b\n" })
          expect(exhausted.status).toBe("cancelled")
          expect(exhausted.reason).toBe("exchanges")
          expect(exhausted.exchanges).toBe(2)
          expect(exhausted.exchangesRemaining).toBe(0)
          expect(exhausted.outputPath).toBe(started.outputPath)

          const afterTerminal = yield* failWith(jobs.write({ sessionID, jobID: started.jobID, input: "c\n" }))
          expect(afterTerminal?._tag).toBe("InteractiveJobs.TerminalJobError")
        }),
      { interactive: new ConfigInteractive.Info({ quiet_window_ms: 40, max_exchanges: 2 }) },
    ))

  it.live("the lifetime reaper cancels expired jobs with reason lifetime", () =>
    withJobs(
      ({ jobs, runtime }) =>
        Effect.gen(function* () {
          const started = yield* jobs.start({ sessionID, command: "./hang" })
          expect(started.status).toBe("waiting")

          yield* Effect.sleep(Duration.millis(250))
          const expired = yield* jobs.wait({ sessionID, jobID: started.jobID, timeout: 2000 })
          expect(expired.status).toBe("cancelled")
          expect(expired.reason).toBe("lifetime")
          expect(runtime.spawned[0]?.child.exited).toBe(true)
        }),
      { interactive: new ConfigInteractive.Info({ quiet_window_ms: 40, default_timeout_ms: 60 }) },
    ))

  it.live("killAll marks every live job cancelled with the given reason", () =>
    withJobs(
      ({ jobs, runtime }) =>
        Effect.gen(function* () {
          const first = yield* jobs.start({ sessionID, command: "one" })
          const second = yield* jobs.start({ sessionID, command: "two" })
          expect(runtime.spawned).toHaveLength(2)

          yield* jobs.killAll({ reason: "session-close" })

          for (const jobID of [first.jobID, second.jobID]) {
            const replay = yield* jobs.wait({ sessionID, jobID, timeout: 1000 })
            expect(replay.status).toBe("cancelled")
            expect(replay.reason).toBe("session-close")
          }
          for (const child of runtime.spawned) expect(child.child.exited).toBe(true)
        }),
      { interactive: quiet },
    ))

  it.live("cancelInFlight kills only the jobs with a call in flight", () =>
    withJobs(
      ({ jobs }) =>
        Effect.gen(function* () {
          const busy = yield* jobs.start({ sessionID, command: "busy" })
          const idle = yield* jobs.start({ sessionID, command: "idle" })

          const inFlight = yield* Effect.forkChild(jobs.write({ sessionID, jobID: busy.jobID, input: "interrupt me\n" }))
          yield* jobs.cancelInFlight({ sessionID, reason: "interrupt" })

          const interruptedExit = yield* Fiber.await(inFlight)
          if (!Exit.isSuccess(interruptedExit)) return yield* Effect.die("expected the in-flight write to settle")
          expect(interruptedExit.value.status).toBe("cancelled")
          expect(interruptedExit.value.reason).toBe("interrupt")

          const survivor = yield* jobs.write({ sessionID, jobID: idle.jobID, input: "still here\n" })
          expect(survivor.status).toBe("waiting")

          yield* jobs.killAll({ reason: "session-close" })
        }),
      { interactive: quiet },
    ))

  it.live("interrupting a call mid-settle kills the job with reason interrupt and releases the claim (spec R32/I10)", () =>
    withJobs(
      ({ jobs }) =>
        Effect.gen(function* () {
          const started = yield* jobs.start({ sessionID, command: "./hang" })
          expect(started.status).toBe("waiting")

          // a wait parks on its deadline — it cannot settle early through the
          // quiescence path — so the interrupt lands deterministically mid-settle
          const inFlight = yield* Effect.forkChild(jobs.wait({ sessionID, jobID: started.jobID, timeout: 5000 }))
          yield* Effect.sleep(Duration.millis(100))
          yield* jobs.cancelInFlight({ sessionID, reason: "interrupt" })

          const interruptedExit = yield* Fiber.await(inFlight)
          if (!Exit.isSuccess(interruptedExit)) return yield* Effect.die("expected the in-flight wait to settle")
          expect(interruptedExit.value.status).toBe("cancelled")
          expect(interruptedExit.value.reason).toBe("interrupt")

          // the claim was released: the terminal replay does not report busy and
          // names the interrupt reason
          const replay = yield* jobs.wait({ sessionID, jobID: started.jobID, timeout: 1000 })
          expect(replay.status).toBe("cancelled")
          expect(replay.reason).toBe("interrupt")
        }),
      { interactive: quiet },
    ))

  it.live("a start call counts as in flight for the interrupt kill (spec I10)", () =>
    withJobs(
      ({ jobs, runtime }) =>
        Effect.gen(function* () {
          // the child stays silent, so the start's quiescence window runs the
          // full 300ms from the fresh lastByteAt taken at job creation
          const inFlightStart = yield* Effect.forkChild(jobs.start({ sessionID, command: "./hang" }))
          yield* Effect.sleep(Duration.millis(100))
          expect(runtime.spawned).toHaveLength(1)
          yield* jobs.cancelInFlight({ sessionID, reason: "interrupt" })

          const interruptedExit = yield* Fiber.await(inFlightStart)
          if (!Exit.isSuccess(interruptedExit)) return yield* Effect.die("expected the in-flight start to settle")
          expect(interruptedExit.value.status).toBe("cancelled")
          expect(interruptedExit.value.reason).toBe("interrupt")
          expect(runtime.spawned[0]?.child.exited).toBe(true)
        }),
      { interactive: new ConfigInteractive.Info({ quiet_window_ms: 300 }) },
    ))

  it.live("a non-mine call that finds the job free claims it and still releases on settle (spec R19)", () =>
    withJobs(
      ({ jobs }) =>
        Effect.gen(function* () {
          const started = yield* jobs.start({ sessionID, command: "./repl" })
          const first = yield* Effect.forkChild(jobs.write({ sessionID, jobID: started.jobID, input: "a\n" }))
          // constructed while the first call holds the intent, so it runs non-mine
          const second = jobs.write({ sessionID, jobID: started.jobID, input: "b\n" })

          const firstExit = yield* Fiber.await(first)
          if (!Exit.isSuccess(firstExit)) return yield* Effect.die("expected the first write to settle")
          expect(firstExit.value.status).toBe("waiting")

          const secondResult = yield* second
          expect(secondResult.status).toBe("waiting")

          // the non-mine call released its claim: the job is not permanently busy
          const third = yield* jobs.write({ sessionID, jobID: started.jobID, input: "c\n" })
          expect(third.status).toBe("waiting")

          yield* jobs.killAll({ reason: "session-close" })
        }),
      {
        interactive: quiet,
        runtime: { schedule: [{ bytes: "repl> ", delayMs: 4 }], respond: (input) => ({ bytes: `got: ${input}` }) },
      },
    ))

  it.live("concurrent starts reserve max_jobs slots synchronously and never oversubscribe (spec R9)", () =>
    withJobs(
      ({ jobs }) =>
        Effect.gen(function* () {
          const exits = yield* Effect.all(
            [1, 2, 3].map((n) => Effect.exit(jobs.start({ sessionID, command: `cmd ${n}` }))),
            { concurrency: "unbounded" },
          )
          const succeeded = exits.filter(Exit.isSuccess)
          const failed = exits.filter(Exit.isFailure)
          expect(succeeded).toHaveLength(2)
          expect(failed).toHaveLength(1)
          for (const exit of failed) {
            const error = Option.getOrUndefined(Cause.findErrorOption(exit.cause))
            expect(error?._tag).toBe("InteractiveGovernor.TooManyJobsError")
          }
          yield* jobs.killAll({ reason: "session-close" })
        }),
      { interactive: new ConfigInteractive.Info({ quiet_window_ms: 40, max_jobs: 2 }) },
    ))

  it.live("a start-supplied timeout becomes the job lifetime (spec R7/R20)", () =>
    withJobs(
      ({ jobs, runtime }) =>
        Effect.gen(function* () {
          const started = yield* jobs.start({ sessionID, command: "./hang", timeout: 60 })
          expect(started.status).toBe("waiting")

          yield* Effect.sleep(Duration.millis(250))
          const expired = yield* jobs.wait({ sessionID, jobID: started.jobID, timeout: 2000 })
          expect(expired.status).toBe("cancelled")
          expect(expired.reason).toBe("lifetime")
          expect(runtime.spawned[0]?.child.exited).toBe(true)
        }),
      { interactive: quiet },
    ))
})
