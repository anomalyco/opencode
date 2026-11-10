import { describe, expect } from "bun:test"
import { ai, LanguageModel, LLMEvent } from "@opencode/ai/effect"
import { OpenAIChat } from "@opencode/ai/protocols/openai-chat"
import { TestLLM } from "@opencode/ai/testing"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Location } from "@opencode/core/location"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginPromise } from "@opencode/core/plugin/promise"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { SessionStep } from "@opencode/core/session/runner/step"
import { Snapshot } from "@opencode/core/snapshot"
import { Tool } from "@opencode/core/tool"
import { ToolOutput } from "@opencode/core/tool-output"
import { Deferred, Effect, Exit, Fiber, Layer } from "effect"
import { TestClock } from "effect/testing"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(Layer.merge(PluginTestLayer, TestLLM.testLayer()))

const model = SessionRunnerModel.resolved(
  LanguageModel.make({ id: "test-model", provider: "test", route: OpenAIChat.route }),
  {
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    limit: { context: 100_000, output: 1_000 },
    cost: [],
  },
)

const empty = { type: "object", properties: {}, additionalProperties: false } as const

// Registers the promise tools the tests call. Each reports the signal it was given through `started`.
const register = Effect.fn(function* (started: Deferred.Deferred<AbortSignal | undefined>) {
  const plugins = yield* Plugin.Service
  const report = (signal: AbortSignal | undefined) => Effect.runSync(Deferred.succeed(started, signal))
  yield* PluginPromise.fromPromise({
    id: "stoppable-tools",
    async setup(context) {
      await context.tool.transform((editor) => {
        editor.add({
          name: "listens",
          description: "Rejects once stopped",
          input: empty,
          options: { codemode: false },
          execute: (_input, context) =>
            new Promise<never>((_resolve, reject) => {
              const signal = context.signal
              signal.addEventListener("abort", () => reject(new Error("stopped with partial work")), { once: true })
              report(signal)
            }),
        })
        editor.add({
          name: "deaf",
          description: "Never reads its signal",
          input: empty,
          options: { codemode: false },
          execute: () =>
            new Promise<never>(() => {
              report(undefined)
            }),
        })
        editor.add({
          name: "ignores",
          description: "Reads its signal but never settles",
          input: empty,
          options: { codemode: false },
          execute: (_input, context) =>
            new Promise<never>(() => {
              report(context.signal)
            }),
        })
        editor.add({
          name: "nested",
          description: "Called from CodeMode; reads its signal",
          input: empty,
          execute: (_input, context) =>
            new Promise<never>((_resolve, reject) => {
              const signal = context.signal
              signal.addEventListener("abort", () => reject(new Error("nested stopped")), { once: true })
              report(signal)
            }),
        })
      })
    },
  }).effect(yield* PluginHost.make(plugins, "test"))
})

// Runs one step calling `call`, stops it once the tool started (as the user, or as a server shutdown), and returns
// how its call ended.
const stop = Effect.fn(function* (
  call: LLMEvent,
  reason: "user" | "shutdown",
  afterInterrupt: (interrupting: Fiber.Fiber<void>) => Effect.Effect<void> = () => Effect.void,
) {
  const llm = yield* TestLLM.Test
  const tools = yield* Tool.Service
  const bus = yield* Bus.Service
  const sessions = yield* Session.Service
  const started = yield* Deferred.make<AbortSignal | undefined>()
  yield* register(started)
  const failures: SessionEvent.Tool.Failed["data"][] = []
  yield* bus.listen((event) =>
    Effect.sync(() => {
      if (event.type === SessionEvent.Tool.Failed.type) failures.push(event.data as SessionEvent.Tool.Failed["data"])
    }),
  )
  const steps = yield* SessionStep.make.pipe(
    Effect.provide(
      Layer.mock(Snapshot.Service)({
        capture: () => Effect.succeed(undefined),
        files: () => Effect.succeed([]),
      }),
    ),
    Effect.provide(AppNodeBuilder.build(ToolOutput.node)),
  )
  yield* llm.push(
    TestLLM.complete({ reason: { normalized: "tool-calls" }, usage: { inputTokens: 1, outputTokens: 1 } }, call),
  )
  const snapshot = yield* tools.snapshot()
  const location = yield* Location.Service
  const session = yield* sessions.create({
    location: Location.Ref.make({ directory: location.directory, workspaceID: location.workspaceID }),
  })
  const attempt = yield* steps
    .attempt({
      isLocationClosed: () => false,
      interruption: () => reason,
      sessionID: session.id,
      assistantMessageID: SessionMessage.ID.create(),
      agent: Agent.defaultID,
      model,
      prepared: {
        retry: () => Effect.void,
        request: ai.request({ model: model.model, prompt: "Run a tool" }),
        options: {},
        executeTool: (input) => snapshot.execute(input),
      },
      retry: () => Effect.succeed({ retry: false }),
      recoverContinuation: true,
      recoverOverflow: Effect.succeed(false),
    })
    .pipe(Effect.forkChild({ startImmediately: true }))
  const signal = yield* Deferred.await(started)
  const startedAt = Date.now()
  const interrupting = yield* Fiber.interrupt(attempt).pipe(Effect.forkChild({ startImmediately: true }))
  yield* afterInterrupt(interrupting)
  yield* Fiber.join(interrupting)
  return {
    exit: yield* Fiber.await(attempt),
    elapsed: Date.now() - startedAt,
    failures,
    requests: (yield* llm.requests()).length,
    signal,
  }
})

const generic = { type: "aborted", message: "Tool execution interrupted" }

describe("Promise tool cooperative stop", () => {
  it.live("reports the error of a tool that read its signal and gave up when the user stopped it", () =>
    Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      const after: string[] = []
      yield* hooks.register("tool", "execute.after", (event) =>
        Effect.sync(() => {
          if (event.status === "error") after.push(event.error.message)
        }),
      )
      const { exit, failures, requests, signal } = yield* stop(
        LLMEvent.toolCall({ id: "call-listens", name: "listens", input: {} }),
        "user",
      )
      expect(Exit.hasInterrupts(exit)).toBe(true)
      expect(requests).toBe(1)
      expect(signal?.aborted).toBe(true)
      expect(after).toEqual(["stopped with partial work"])
      expect(failures).toMatchObject([{ id: "call-listens", error: { message: "stopped with partial work" } }])
    }),
  )

  it.live("interrupts a tool that never read its signal at once", () =>
    Effect.gen(function* () {
      const { exit, elapsed, failures, requests } = yield* stop(
        LLMEvent.toolCall({ id: "call-deaf", name: "deaf", input: {} }),
        "user",
      )
      expect(Exit.hasInterrupts(exit)).toBe(true)
      expect(requests).toBe(1)
      // Well under the 5 s a listening tool is given.
      expect(elapsed).toBeLessThan(2_000)
      expect(failures).toMatchObject([{ id: "call-deaf", error: generic }])
    }),
  )

  it.effect("interrupts a tool that read its signal but ignored the stop after the safety net", () =>
    Effect.gen(function* () {
      const { exit, failures, signal } = yield* stop(
        LLMEvent.toolCall({ id: "call-ignores", name: "ignores", input: {} }),
        "user",
        // The stop waits for a tool that read its signal, on the clock; this one never settles.
        (interrupting) =>
          Effect.gen(function* () {
            yield* Effect.promise(() => Bun.sleep(50))
            expect(interrupting.pollUnsafe()).toBeUndefined()
            yield* TestClock.adjust("5 seconds")
          }),
      )
      expect(Exit.hasInterrupts(exit)).toBe(true)
      expect(signal?.aborted).toBe(true)
      expect(failures).toMatchObject([{ id: "call-ignores", error: generic }])
    }),
  )

  it.live("aborts the signal and records the generic result on a server shutdown", () =>
    Effect.gen(function* () {
      const { exit, failures, signal } = yield* stop(
        LLMEvent.toolCall({ id: "call-shutdown", name: "listens", input: {} }),
        "shutdown",
      )
      expect(Exit.hasInterrupts(exit)).toBe(true)
      expect(signal?.aborted).toBe(true)
      expect(failures).toMatchObject([{ id: "call-shutdown", error: generic }])
    }),
  )

  it.live("never lets a promise tool called from CodeMode take the execute call's stop", () =>
    Effect.gen(function* () {
      const { exit, elapsed, failures, signal } = yield* stop(
        LLMEvent.toolCall({ id: "call-execute", name: "execute", input: { code: "return await tools.nested({})" } }),
        "user",
      )
      expect(Exit.hasInterrupts(exit)).toBe(true)
      // The execute call never awaited the stop, so it is interrupted at once, its nested call with it.
      expect(elapsed).toBeLessThan(2_000)
      expect(signal?.aborted).toBe(true)
      expect(failures).toMatchObject([{ id: "call-execute", error: generic }])
    }),
  )
})
