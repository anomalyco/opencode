import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { mkdtemp } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { LanguageModel } from "@opencode-ai/ai"
import * as OpenAIChat from "@opencode-ai/ai/protocols/openai-chat"
import { TestLLM } from "@opencode-ai/ai/testing"
import { Agent } from "@opencode-ai/core/agent"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Bus } from "@opencode-ai/core/bus"
import { Database } from "@opencode-ai/core/database/database"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { SessionEngine } from "@opencode-ai/core/session-engine"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { SessionStore } from "@opencode-ai/core/session/store"
import { testEffect } from "./lib/effect"

const testLLM = TestLLM.layer()
// The environment's engine graph compiles the scripted client from the same
// Layer references the application root uses, so the shared MemoMap yields
// one TestLLM instance for both pushes and drains.
const scriptedClient = TestLLM.clientLayer.pipe(Layer.provide(testLLM))
const shared: LayerNode.Replacements = [
  [Bus.node, Bus.configured({ persist: true })],
  [LayerNodePlatform.llmClient, scriptedClient],
]
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionProjector.node,
      SessionStore.node,
      SessionExecution.node,
      Session.node,
      SessionEngine.node,
    ]),
    [...shared, [SessionEngine.node, SessionEngine.configured(shared)]],
  ).pipe(Layer.provideMerge(testLLM)),
)

const model = SessionRunnerModel.resolved(
  LanguageModel.make({ id: "fake-model", provider: "fake", route: OpenAIChat.route }),
  {
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    cost: [],
    limit: { context: 200_000, output: 32_000 },
  },
)

const executions: string[] = []
const echo = {
  name: "echo",
  description: "Echo text",
  input: Schema.Struct({ text: Schema.String }),
  output: Schema.Struct({ text: Schema.String }),
  options: { codemode: false as const },
  execute: ({ text }: { text: string }) =>
    Effect.sync(() => {
      executions.push(text)
      return { output: { text }, content: text }
    }),
}

describe("SessionEngine", () => {
  it.effect("drains a durable session against a values-constructed environment", () =>
    Effect.gen(function* () {
      executions.length = 0
      const directory = AbsolutePath.make(
        yield* Effect.promise(() => mkdtemp(path.join(tmpdir(), "session-engine-"))),
      )
      const envs = yield* SessionEngine.Service
      const env = yield* envs.make({
        directory,
        model,
        agents: (draft) => {
          draft.update(Agent.defaultID, () => {})
          draft.default(Agent.defaultID)
        },
        tools: (draft) => draft.add(echo),
      })
      const session = yield* env.session()

      yield* TestLLM.push(TestLLM.tool("call_1", "echo", { text: "hello" }), TestLLM.text("done", "out_1"))
      yield* session.prompt({ text: "use echo", resume: false })
      const sessions = yield* Session.Service
      yield* sessions.resume(session.id)

      // The values tool executed inside the real drain.
      expect(executions).toEqual(["hello"])

      // The drain produced durable assistant history containing the scripted reply.
      const messages = yield* sessions.messages({ sessionID: session.id })
      const assistant = messages.filter((message) => message.type === "assistant")
      expect(assistant.length).toBeGreaterThan(0)
      const text = assistant
        .flatMap((message) => message.content)
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("\n")
      expect(text).toContain("done")

      // Reconnect: the same call with the same ID adopts the existing Session.
      const reconnected = yield* env.session({ id: session.id, title: "ignored on adoption" })
      expect(reconnected.id).toBe(session.id)
      expect((yield* sessions.messages({ sessionID: reconnected.id })).length).toBe(messages.length)
    }),
  )
})
