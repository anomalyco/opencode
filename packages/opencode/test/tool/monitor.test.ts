import { afterEach, describe, expect, test } from "bun:test"
import { Database } from "@opencode-ai/core/database/database"
import { Effect, Layer } from "effect"
import { Agent } from "@/agent/agent"
import { BackgroundJob } from "@/background/job"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Config } from "@/config/config"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Session } from "@/session/session"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { MonitorTool } from "../../src/tool/monitor"
import { testEffect } from "../lib/effect"
import { MessageID, SessionID } from "../../src/session/schema"
import { disposeAllInstances } from "../fixture/fixture"

afterEach(async () => {
  await disposeAllInstances()
})

const layer = Layer.mergeAll(
  Agent.defaultLayer,
  BackgroundJob.defaultLayer,
  EventV2Bridge.defaultLayer,
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

      expect(promptCalls.length).toBeGreaterThan(0)
      expect(promptCalls[promptCalls.length - 1].text).toContain("Monitor exited")
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

        const events = promptCalls.filter((p) => p.text.includes("Event:"))
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
        const events = promptCalls.filter((p) => p.text.includes("Event:"))
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
        const events = promptCalls.filter((p) => p.text.includes("Event:"))
        expect(events.length).toBeGreaterThanOrEqual(1)

        // Verify event contents
        const texts = events.map((e) => e.text)
        expect(texts.some((t) => t.includes("first line"))).toBe(true)
        expect(texts.some((t) => t.includes("second line"))).toBe(true)
      }),
    )
  })
}
