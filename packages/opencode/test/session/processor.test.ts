import { describe, expect, spyOn, test } from "bun:test"
import { Effect, Layer } from "effect"
import * as Stream from "effect/Stream"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LLMEvent } from "@opencode-ai/llm"
import type { Agent } from "../../src/agent/agent"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Image } from "../../src/image/image"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { ModelID, ProviderID } from "../../src/provider/schema"
import type { Provider } from "../../src/provider/provider"
import { Snapshot } from "../../src/snapshot"
import { Session as SessionNs } from "../../src/session/session"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID } from "../../src/session/schema"
import { SessionProcessor } from "../../src/session/processor"
import { SessionRetry } from "../../src/session/retry"
import { SessionStatus } from "../../src/session/status"
import { SessionSummary } from "../../src/session/summary"
import { provideTmpdirInstance } from "../fixture/fixture"

const model: Provider.Model = {
  id: ModelID.make("test-model"),
  providerID: ProviderID.make("test"),
  api: {
    id: "test-model",
    url: "https://example.com",
    npm: "@ai-sdk/openai",
  },
  name: "Test Model",
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: {
      text: true,
      audio: false,
      image: false,
      video: false,
      pdf: false,
    },
    output: {
      text: true,
      audio: false,
      image: false,
      video: false,
      pdf: false,
    },
    interleaved: false,
  },
  cost: {
    input: 0,
    output: 0,
    cache: {
      read: 0,
      write: 0,
    },
  },
  limit: {
    context: 0,
    input: 0,
    output: 0,
  },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
}

const agent = {
  name: "test",
  mode: "primary",
  options: {},
  permission: [{ permission: "*", pattern: "*", action: "allow" }],
} satisfies Agent.Info

function user(id: string, session: string): MessageV2.User {
  return {
    id: MessageID.make(id),
    sessionID: session,
    role: "user",
    time: { created: Date.now() },
    agent: agent.name,
    model: { providerID: model.providerID, modelID: model.id },
    tools: {},
    mode: "",
  } as unknown as MessageV2.User
}

function assistant(id: string, session: string, parent: string): MessageV2.Assistant {
  return {
    id: MessageID.make(id),
    sessionID: session,
    role: "assistant",
    parentID: MessageID.make(parent),
    time: { created: Date.now() },
    modelID: model.id,
    providerID: model.providerID,
    mode: agent.name,
    agent: agent.name,
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  } as unknown as MessageV2.Assistant
}

function stalled(chunks: LLMEvent[], cancel: () => void): AsyncIterable<LLMEvent> {
  return {
    [Symbol.asyncIterator]() {
      let index = 0
      return {
        async next() {
          if (index < chunks.length) {
            return { done: false, value: chunks[index++] }
          }
          return new Promise<IteratorResult<LLMEvent>>(() => {})
        },
        async return() {
          cancel()
          return { done: true, value: undefined }
        },
      }
    },
  }
}

async function process(stream: AsyncIterable<LLMEvent>, override?: { model?: Provider.Model }) {
  let calls = 0
  const abort = new AbortController()
  const delay = spyOn(SessionRetry, "delay").mockImplementation(() => 1)
  try {
    const program = provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const session = yield* SessionNs.Service
          const processors = yield* SessionProcessor.Service
          const created = yield* session.create({})
          const parent = MessageID.ascending()
          const message = MessageID.ascending()
          const testModel = override?.model ?? model
          const current = user(parent, created.id)
          const assistantMessage = yield* session.updateMessage(assistant(message, created.id, parent))
          const processor = yield* processors.create({
            assistantMessage: assistantMessage as MessageV2.Assistant,
            sessionID: created.id,
            model: testModel,
            abort: abort.signal,
            timeout: {
              firstByte: 5,
              idle: 5,
            },
          })
          const result = yield* processor.process({
            user: current,
            sessionID: created.id,
            model: testModel,
            agent,
            system: [],
            messages: [],
            tools: {},
          })
          return {
            result,
            calls,
            assistantMessage: processor.message,
            parts: MessageV2.parts(message),
          }
        }),
      { git: true },
    ).pipe(Effect.provide(testLayer(stream, () => calls++)))
    return await Effect.runPromise(Effect.scoped(program))
  } finally {
    delay.mockRestore()
  }
}

function testLayer(stream: AsyncIterable<LLMEvent>, called: () => void) {
  const llm = Layer.succeed(
    LLM.Service,
    LLM.Service.of({
      stream: () => {
        called()
        return Stream.fromAsyncIterable(stream, (error) => error)
      },
    }),
  )
  const summary = Layer.succeed(
    SessionSummary.Service,
    SessionSummary.Service.of({
      summarize: () => Effect.void,
      diff: () => Effect.succeed([]),
      computeDiff: () => Effect.succeed([]),
    }),
  )
  const deps = Layer.mergeAll(
    SessionNs.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Snapshot.defaultLayer,
    AgentSvc.defaultLayer,
    Permission.defaultLayer,
    Plugin.defaultLayer,
    SessionStatus.defaultLayer,
    Bus.layer,
    Config.defaultLayer,
    RuntimeFlags.layer({ experimentalEventSystem: true }),
    EventV2Bridge.defaultLayer,
  )
  const processor = SessionProcessor.layer.pipe(
    Layer.provide(llm),
    Layer.provide(summary),
    Layer.provide(Image.defaultLayer),
    Layer.provideMerge(deps),
  )
  return Layer.mergeAll(deps, processor)
}

describe("session.processor stream watchdog", () => {
  test("retries and stops when stream never yields first chunk", async () => {
    let canceled = 0
    const output = await process(stalled([], () => canceled++))

    expect(output.result).toBe("stop")
    expect(output.calls).toBe(SessionProcessor.RETRY_MAX + 1)
    expect(canceled).toBe(SessionProcessor.RETRY_MAX + 1)
    expect(output.assistantMessage.error?.name).toBe("APIError")
    expect(errorMessage(output.assistantMessage.error?.data)).toContain("Stream first byte timed out")
  })

  test("retries and stops when stream idles after first chunk", async () => {
    let canceled = 0
    const output = await process(
      stalled(
        [
          LLMEvent.textStart({ id: "text-0" }),
          LLMEvent.textDelta({ id: "text-0", text: "hello" }),
          LLMEvent.textEnd({ id: "text-0" }),
        ],
        () => canceled++,
      ),
    )

    expect(output.result).toBe("stop")
    expect(output.calls).toBe(SessionProcessor.RETRY_MAX + 1)
    expect(canceled).toBe(SessionProcessor.RETRY_MAX + 1)
    expect(output.assistantMessage.error?.name).toBe("APIError")
    expect(errorMessage(output.assistantMessage.error?.data)).toContain("Stream idle timed out")
    expect(output.parts.some((part) => part.type === "text" && part.text.includes("hello"))).toBe(true)
  })

  test("closes provider stream when compaction exits stream early", async () => {
    let canceled = 0
    const compactModel: Provider.Model = { ...model, limit: { ...model.limit, context: 1, output: 0 } }
    const output = await process(
      stalled(
        [
          LLMEvent.stepFinish({
            index: 0,
            reason: "stop",
            usage: {
              inputTokens: 1,
              outputTokens: 1,
              totalTokens: 2,
            },
          }),
        ],
        () => canceled++,
      ),
      { model: compactModel },
    )

    expect(output.result).toBe("compact")
    expect(output.calls).toBe(1)
    expect(canceled).toBe(1)
  })
})

function errorMessage(data: unknown) {
  if (!data || typeof data !== "object") return ""
  if (!("message" in data)) return ""
  return typeof data.message === "string" ? data.message : ""
}
