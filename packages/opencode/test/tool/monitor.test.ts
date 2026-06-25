import { afterEach, describe, expect, test } from "bun:test"
import { Database } from "@opencode-ai/core/database/database"
import { Effect, Layer } from "effect"
import { Agent } from "@/agent/agent"
import { BackgroundJob } from "@/background/job"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Config } from "@/config/config"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Session } from "@/session/session"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { MonitorTool } from "../../src/tool/monitor"
import { MonitorStopTool } from "../../src/tool/monitor-stop"
import { MonitorListTool } from "../../src/tool/monitor-list"
import { testEffect } from "../lib/effect"
import { MessageID, SessionID } from "../../src/session/schema"
import { disposeAllInstances } from "../fixture/fixture"

afterEach(async () => {
  await disposeAllInstances()
})

const layer = Layer.mergeAll(
  Agent.defaultLayer,
  BackgroundJob.defaultLayer,
  Config.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
  Session.defaultLayer,
  SessionRunState.defaultLayer,
  SessionStatus.defaultLayer,
  Truncate.defaultLayer,
  ToolRegistry.defaultLayer,
  Database.defaultLayer,
  RuntimeFlags.layer({ experimentalMonitor: true }),
).pipe(Layer.provide(Ripgrep.defaultLayer))

const it = testEffect(layer)

const ref = {
  providerID: "test" as any,
  modelID: "test-model" as any,
}

const seed = Effect.gen(function* () {
  const session = yield* Session.Service
  const chat = yield* session.create({ title: "MonitorTest" })
  const user = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID: chat.id,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  const assistant = {
    id: MessageID.ascending(),
    role: "assistant" as const,
    parentID: user.id,
    sessionID: chat.id,
    mode: "build",
    agent: "build",
    cost: 0,
    path: { cwd: chat.directory, root: chat.directory },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    time: { created: Date.now() },
  }
  yield* session.updateMessage(assistant)
  return { chat, assistant }
})

const runMonitor = Effect.gen(function* () {
  const info = yield* MonitorTool
  const tool = yield* info.init()
  return tool
})

const runMonitorStop = Effect.gen(function* () {
  const info = yield* MonitorStopTool
  const tool = yield* info.init()
  return tool
})

const runMonitorList = Effect.gen(function* () {
  const info = yield* MonitorListTool
  const tool = yield* info.init()
  return tool
})

describe("MonitorTool", () => {
  it.instance("arms a monitor and returns immediately", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed
      const monitor = yield* runMonitor
      const promptCalls: Array<{ text: string }> = []

      const ops = {
        prompt: (input: any) =>
          Effect.sync(() => {
            promptCalls.push(input.parts[0])
          }),
      }

      const result = yield* monitor.execute(
        {
          command: "echo 'hello'",
          description: "test monitor",
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps: ops },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      expect(result.output).toContain("Monitor armed")
      expect(result.metadata.monitor).toBe(true)
      expect(result.metadata.description).toBe("test monitor")

      // Wait briefly for the monitor to exit and trigger callbacks
      yield* Effect.sleep("500 millis")

      // Output batch + exit note both arrive (order is not guaranteed: the final
      // batch flush is detached, so assert presence, not position).
      expect(promptCalls.length).toBeGreaterThan(0)
      expect(promptCalls.some((p) => p.text.includes("hello"))).toBe(true)
      expect(promptCalls.some((p) => p.text.includes("Monitor exited"))).toBe(true)
    }),
  )

  // Regression for the re-arm deadlock. The trigger is SELF-CANCEL: the model is
  // woken by monitor A's output and, from inside that wake turn, re-arms the
  // monitor — which cancels A's job. With forkIn(jobScope), A's emit fiber (the
  // fiber currently running this very ops.prompt) is in the scope cancel() closes,
  // so cancel -> Scope.close interrupts+awaits the fiber it is running on. If that
  // self-cancel deadlocks (the original 40-min hang) or silently kills the re-arm,
  // monitor B never arms and "rearmed" never appears. We give the whole flow a hard
  // timeout so a hang FAILS fast instead of wedging the suite.
  it.instance("re-arming from inside a wake turn does not deadlock (self-cancel)", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed
      const monitor = yield* runMonitor
      const jobs = yield* BackgroundJob.Service
      const promptCalls: Array<{ text: string }> = []
      let rearmed = false

      const ctx: any = {
        sessionID: chat.id,
        messageID: assistant.id,
        agent: "build",
        abort: new AbortController().signal,
        extra: { promptOps: undefined },
        messages: [],
        metadata: () => Effect.void,
        ask: () => Effect.void,
      }

      // On the first real output wake, re-arm from within the wake effect itself.
      // This effect runs in A's emit fiber (forkIn jobScope), exactly the fiber
      // cancel()'s Scope.close will interrupt — the worst-case self-cancel.
      const ops = {
        prompt: (input: any) =>
          Effect.gen(function* () {
            promptCalls.push(input.parts[0])
            if (!rearmed && input.parts[0].text.includes("monitor_output")) {
              rearmed = true
              // B stays running (sleep) so the "exactly one live monitor" assertion
              // below sees B, not a B that already exited.
              yield* monitor.execute({ command: "bash -c 'echo rearmed-ok; sleep 5'", description: "self-cancel" }, ctx)
            }
          }),
      }
      ctx.extra.promptOps = ops

      const result = yield* monitor.execute(
        { command: "bash -c 'echo first; sleep 2; echo second'", description: "self-cancel" },
        ctx,
      )
      expect(result.output).toContain("Monitor armed")

      // Wait for: A emits -> wake re-arms B -> B emits "rearmed-ok". If the
      // self-cancel deadlocks or aborts the re-arm, B never emits and this assert
      // is never satisfied; the outer timeout converts the hang into a failure.
      yield* Effect.gen(function* () {
        while (!promptCalls.some((p) => p.text.includes("rearmed-ok"))) {
          yield* Effect.sleep("100 millis")
        }
      }).pipe(
        // On a self-cancel deadlock B never emits rearmed-ok, so this loop never
        // settles; the timeout converts the hang into a TimeoutException -> test fails.
        Effect.timeout("8 seconds"),
      )

      expect(rearmed).toBe(true)
      expect(promptCalls.some((p) => p.text.includes("rearmed-ok"))).toBe(true)

      // Re-arm must REPLACE: monitor A's job is actually cancelled (not orphaned). Wait
      // past A's "sleep 2" so a NOT-cancelled A would have emitted "second" — that line
      // must never appear, and exactly one monitor (B) must remain running. Without this,
      // an orphan-watcher regression (arm B but never cancel A) would pass on no-hang alone.
      const aId = result.metadata.monitorId
      yield* Effect.sleep("2500 millis")
      const aInfo = yield* jobs.get(aId)
      expect(aInfo?.status).toBe("cancelled")
      expect(promptCalls.some((p) => p.text.includes("second"))).toBe(false)
      const liveMonitors = (yield* jobs.list()).filter((j) => j.type === "monitor" && j.status === "running")
      expect(liveMonitors.length).toBe(1)
    }),
  )

  // F3: the EXIT-then-rearm variant. The 'Monitor exited' note explicitly invites a
  // re-arm; if the model does so, it cancels the just-exited job from inside the very
  // fiber delivering that note. This is a DIFFERENT path from the per-batch self-cancel
  // (the exit note is emitted by the tool's exit hook, not runShellJob's forked wake),
  // so it needs its own coverage. Same hard timeout: a hang fails fast.
  it.instance("re-arming on the 'Monitor exited' note does not deadlock (exit-then-rearm)", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed
      const monitor = yield* runMonitor
      const promptCalls: Array<{ text: string }> = []
      let rearmed = false

      const ctx: any = {
        sessionID: chat.id,
        messageID: assistant.id,
        agent: "build",
        abort: new AbortController().signal,
        extra: { promptOps: undefined },
        messages: [],
        metadata: () => Effect.void,
        ask: () => Effect.void,
      }

      const ops = {
        prompt: (input: any) =>
          Effect.gen(function* () {
            promptCalls.push(input.parts[0])
            if (!rearmed && input.parts[0].text.includes("Monitor exited")) {
              rearmed = true
              yield* monitor.execute({ command: "echo 'rearmed-ok'", description: "exit-rearm" }, ctx)
            }
          }),
      }
      ctx.extra.promptOps = ops

      // A command that EXITS on its own -> fires the 'Monitor exited' note.
      const result = yield* monitor.execute(
        { command: "bash -c 'echo first'", description: "exit-rearm" },
        ctx,
      )
      expect(result.output).toContain("Monitor armed")

      yield* Effect.gen(function* () {
        while (!promptCalls.some((p) => p.text.includes("rearmed-ok"))) {
          yield* Effect.sleep("100 millis")
        }
      }).pipe(Effect.timeout("8 seconds"))

      expect(rearmed).toBe(true)
      expect(promptCalls.some((p) => p.text.includes("rearmed-ok"))).toBe(true)
    }),
  )

  // Byte-flood guard: the line-based flood cap counts COMPLETE lines, so a watcher
  // spewing bytes with no newline would grow the carry buffer unbounded and never trip
  // it. The byte cap must catch that — emit a flood warning and stop.
  it.instance("stops a watcher that emits bytes with no newline (byte flood)", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed
      const monitor = yield* runMonitor
      const promptCalls: Array<{ text: string }> = []

      const ops = {
        prompt: (input: any) =>
          Effect.sync(() => {
            promptCalls.push(input.parts[0])
          }),
      }

      // ~2MB of 'x' with NO newline -> carry exceeds CARRY_MAX_CHARS (1MB).
      const result = yield* monitor.execute(
        { command: "bash -c 'head -c 2000000 /dev/zero | tr \"\\0\" \"x\"'", description: "byte flood" },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps: ops },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )
      expect(result.output).toContain("Monitor armed")

      // Wait for the byte-flood guard to fire its warning.
      yield* Effect.gen(function* () {
        while (!promptCalls.some((p) => p.text.includes("no newline"))) {
          yield* Effect.sleep("100 millis")
        }
      }).pipe(Effect.timeout("8 seconds"))

      expect(promptCalls.some((p) => p.text.includes("flood guard") && p.text.includes("no newline"))).toBe(true)
    }),
  )

  // Concurrency: monitors are NOT one-per-session. Distinct descriptions run as distinct,
  // concurrent jobs (watch a local file AND a remote log at once). Re-arming the SAME
  // description replaces only that watch (dedup) — the count must reach 2, stay 2 on a
  // same-desc re-arm (never 3), and the replaced job must be cancelled (never 1).
  it.instance("runs distinct-description monitors concurrently (re-arm replaces only same description)", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed
      const monitor = yield* runMonitor
      const jobs = yield* BackgroundJob.Service

      const ctx = (description: string) => ({
        sessionID: chat.id,
        messageID: assistant.id,
        agent: "build" as const,
        abort: new AbortController().signal,
        extra: { promptOps: { prompt: () => Effect.void } },
        messages: [],
        metadata: () => Effect.void,
        ask: () => Effect.void,
      })
      const liveMonitors = Effect.gen(function* () {
        return (yield* jobs.list()).filter((j) => j.type === "monitor" && j.status === "running")
      })

      // Two DISTINCT descriptions -> two concurrent monitors.
      yield* monitor.execute({ command: "bash -c 'sleep 30'", description: "watch-local" }, ctx("watch-local"))
      const a = yield* monitor.execute({ command: "bash -c 'sleep 30'", description: "watch-remote" }, ctx("watch-remote"))
      expect((yield* liveMonitors).length).toBe(2)

      // Re-arm the SAME description ("watch-remote") -> replaces only that one: still 2,
      // and the prior watch-remote job is cancelled (dedup-replace, never stacks to 3).
      const aId = a.metadata.monitorId
      yield* monitor.execute({ command: "bash -c 'sleep 30'", description: "watch-remote" }, ctx("watch-remote"))
      yield* Effect.sleep("200 millis")
      expect((yield* liveMonitors).length).toBe(2)
      expect((yield* jobs.get(aId))?.status).toBe("cancelled")
    }),
  )

  // monitor_stop retires a specific watch by description (the leak we hit: a corrected
  // re-arm with a DIFFERENT description leaves the old monitor running; monitor_stop is
  // the explicit way to retire it). Stop by description drops only that one; the other
  // monitor keeps running. Also covers stop-by-id and the missing-id no-op.
  it.instance("monitor_stop retires one watch by description and by id, leaving others running", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed
      const monitor = yield* runMonitor
      const monitorStop = yield* runMonitorStop
      const jobs = yield* BackgroundJob.Service

      const ctx = (description: string) => ({
        sessionID: chat.id,
        messageID: assistant.id,
        agent: "build" as const,
        abort: new AbortController().signal,
        extra: { promptOps: { prompt: () => Effect.void } },
        messages: [],
        metadata: () => Effect.void,
        ask: () => Effect.void,
      })
      const liveMonitors = Effect.gen(function* () {
        return (yield* jobs.list()).filter(
          (j) => j.type === "monitor" && j.status === "running" && j.metadata?.["sessionId"] === chat.id,
        )
      })

      const a = yield* monitor.execute({ command: "bash -c 'sleep 30'", description: "watch-A" }, ctx("watch-A"))
      yield* monitor.execute({ command: "bash -c 'sleep 30'", description: "watch-B" }, ctx("watch-B"))
      expect((yield* liveMonitors).length).toBe(2)

      // Stop by description -> only watch-B gone.
      const stoppedB = yield* monitorStop.execute({ description: "watch-B" }, ctx("watch-B"))
      expect((stoppedB.metadata as { stopped: boolean }).stopped).toBe(true)
      yield* Effect.sleep("300 millis")
      const afterB = yield* liveMonitors
      expect(afterB.length).toBe(1)
      expect(afterB[0]!.metadata?.["description"]).toBe("watch-A")

      // Stop the remaining one by the id the arm returned -> none left.
      const aId = a.metadata.monitorId
      const stoppedA = yield* monitorStop.execute({ id: aId }, ctx("watch-A"))
      expect((stoppedA.metadata as { stopped: boolean }).stopped).toBe(true)
      yield* Effect.sleep("300 millis")
      expect((yield* liveMonitors).length).toBe(0)

      // Stopping a non-existent id is a no-op, not an error.
      const miss = yield* monitorStop.execute({ id: "job_doesnotexist" }, ctx("watch-A"))
      expect((miss.metadata as { stopped: boolean }).stopped).toBe(false)
    }),
  )

  // monitor_list enumerates the running monitors in this session so the model can recover
  // ids/descriptions it didn't keep (then stop the right one). Empty when nothing runs.
  it.instance("monitor_list enumerates running monitors and is empty when none run", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed
      const monitor = yield* runMonitor
      const monitorList = yield* runMonitorList

      const ctx = (description: string) => ({
        sessionID: chat.id,
        messageID: assistant.id,
        agent: "build" as const,
        abort: new AbortController().signal,
        extra: { promptOps: { prompt: () => Effect.void } },
        messages: [],
        metadata: () => Effect.void,
        ask: () => Effect.void,
      })

      // Empty to start.
      const empty = yield* monitorList.execute({}, ctx("list"))
      expect((empty.metadata as { count: number }).count).toBe(0)
      expect(empty.output).toContain("No active")

      // Two distinct monitors -> both listed with their descriptions.
      const a = yield* monitor.execute({ command: "bash -c 'sleep 30'", description: "watch-A" }, ctx("watch-A"))
      yield* monitor.execute({ command: "bash -c 'sleep 30'", description: "watch-B" }, ctx("watch-B"))
      const listed = yield* monitorList.execute({}, ctx("list"))
      const meta = listed.metadata as { count: number; monitors: Array<{ id: string; description: string }> }
      expect(meta.count).toBe(2)
      expect(meta.monitors.map((m) => m.description).sort()).toEqual(["watch-A", "watch-B"])
      expect(meta.monitors.map((m) => m.id)).toContain(a.metadata.monitorId)
      expect(listed.output).toContain("watch-A")
    }),
  )
})

if (process.env.OPENCODE_LIVE_MONITOR_TEST) {
  describe("MonitorTool live", () => {
    it.instance("watches a live command and emits events", () =>
      Effect.gen(function* () {
        const { chat, assistant } = yield* seed
        const monitor = yield* runMonitor
        const promptCalls: Array<{ text: string }> = []

        const ops = {
          prompt: (input: any) =>
            Effect.sync(() => {
              promptCalls.push(input.parts[0])
            }),
        }

        const result = yield* monitor.execute(
          {
            command: "bash -c 'echo event1; sleep 0.2; echo event2; sleep 0.2'",
            description: "live test",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps: ops },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        expect(result.output).toContain("Monitor armed")

        yield* Effect.sleep("1 second")

        const events = promptCalls.filter((p) => p.text.includes("monitor_output"))
        expect(events.length).toBeGreaterThanOrEqual(1)
      }),
    )

    it.instance("watches file ./f for changes and emits events", () =>
      Effect.gen(function* () {
        const { chat, assistant } = yield* seed
        const monitor = yield* runMonitor
        const promptCalls: Array<{ text: string }> = []

        const ops = {
          prompt: (input: any) =>
            Effect.sync(() => {
              promptCalls.push(input.parts[0])
            }),
        }

        // Pre-create the file so monitor finds it immediately
        // Note: must include newline so monitor's line-splitter picks it up
        const watchFile = `${chat.directory}/f`
        yield* Effect.promise(() => Bun.write(watchFile, "change1\n"))

        // Monitor: first print cwd to verify directory, then poll for file
        const result = yield* monitor.execute(
          {
            command: "bash -c 'while true; do if [ -f ./f ]; then cat ./f; rm ./f; fi; sleep 0.1; done'",
            description: "watch file ./f for changes",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps: ops },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        expect(result.output).toContain("Monitor armed")
        expect(result.metadata.description).toBe("watch file ./f for changes")

        // Wait for monitor to detect pre-existing file
        yield* Effect.sleep("500 millis")

        // Trigger second change
        yield* Effect.promise(() => Bun.write(watchFile, "change2\n"))
        yield* Effect.sleep("500 millis")

        // Trigger third change
        yield* Effect.promise(() => Bun.write(watchFile, "change3\n"))
        yield* Effect.sleep("500 millis")

        // Collect events
        const events = promptCalls.filter((p) => p.text.includes("monitor_output"))
        expect(events.length).toBeGreaterThanOrEqual(1)

        // Verify event contents
        const texts = events.map((e) => e.text)
        expect(texts.some((t) => t.includes("change1"))).toBe(true)
        expect(texts.some((t) => t.includes("change2"))).toBe(true)
        expect(texts.some((t) => t.includes("change3"))).toBe(true)
      }),
    )

    it.instance("E2E: prompts for watch and then changes file", () =>
      Effect.gen(function* () {
        const { chat, assistant } = yield* seed
        const monitor = yield* runMonitor
        const promptCalls: Array<{ text: string }> = []

        const ops = {
          prompt: (input: any) =>
            Effect.sync(() => {
              promptCalls.push(input.parts[0])
            }),
        }

        const watchFile = `${chat.directory}/watchme.txt`

        // Create initial file
        yield* Effect.promise(() => Bun.write(watchFile, "initial\n"))

        // Simulate user prompt: "watch watchme.txt for changes"
        // Use a polling loop that detects file changes and reads them
        const result = yield* monitor.execute(
          {
            command: "bash -c 'while true; do if [ -f ./watchme.txt ]; then cat ./watchme.txt; rm ./watchme.txt; fi; sleep 0.1; done'",
            description: "watch watchme.txt for changes",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps: ops },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        expect(result.output).toContain("Monitor armed")
        expect(result.metadata.description).toBe("watch watchme.txt for changes")

        // Give monitor time to detect initial file
        yield* Effect.sleep("500 millis")

        // Simulate file change: user writes a line
        yield* Effect.promise(() => Bun.write(watchFile, "first line\n"))
        yield* Effect.sleep("500 millis")

        // Simulate another file change
        yield* Effect.promise(() => Bun.write(watchFile, "second line\n"))
        yield* Effect.sleep("500 millis")

        // Collect events
        const events = promptCalls.filter((p) => p.text.includes("monitor_output"))
        expect(events.length).toBeGreaterThanOrEqual(1)

        // Verify event contents
        const texts = events.map((e) => e.text)
        expect(texts.some((t) => t.includes("first line"))).toBe(true)
        expect(texts.some((t) => t.includes("second line"))).toBe(true)
      }),
    )
  })
}
