import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import path from "path"
import { pathToFileURL } from "url"
import { Session } from "@/session/session"
import { SessionPrompt } from "../../src/session/prompt"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { provideTmpdirServer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

const plugin = pathToFileURL(path.join(__dirname, "../fixture/session-start-plugin.ts")).href

const providerCfg = (url: string) => ({
  plugin: [plugin],
  provider: {
    test: {
      name: "Test",
      id: "test",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        "test-model": {
          id: "test-model",
          name: "Test Model",
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          limit: { context: 100000, output: 10000 },
          cost: { input: 0, output: 0 },
          options: {},
        },
      },
      options: {
        apiKey: "test-key",
        baseURL: url,
      },
    },
  },
})

const it = testEffect(
  Layer.mergeAll(TestLLMServer.layer, SessionPrompt.defaultLayer, Session.defaultLayer, CrossSpawnSpawner.defaultLayer),
)

describe("session.start hook", () => {
  it.live("injects context only before the first session model call", () =>
    provideTmpdirServer(
      ({ llm }) =>
        Effect.gen(function* () {
          const prompt = yield* SessionPrompt.Service
          const sessions = yield* Session.Service
          const session = yield* sessions.create({ title: "session start test" })

          yield* llm.text("first response")
          yield* prompt.prompt({
            sessionID: session.id,
            agent: "build",
            model: ref,
            parts: [{ type: "text", text: "first user" }],
          })

          yield* llm.text("second response")
          yield* prompt.prompt({
            sessionID: session.id,
            agent: "build",
            model: ref,
            parts: [{ type: "text", text: "second user" }],
          })

          const bodies = yield* llm.inputs
          const first = bodies.find((body) => JSON.stringify(body).includes("first user"))
          const second = bodies.find((body) => JSON.stringify(body).includes("second user"))

          expect(JSON.stringify(first)).toContain("session start context")
          expect(JSON.stringify(first)).toContain("parent=none")
          expect(JSON.stringify(first)).toContain("agent=build")
          expect(JSON.stringify(second)).not.toContain("session start context")
        }),
      { git: true, config: providerCfg },
    ),
  )

  it.live("includes parent session and agent context for child sessions", () =>
    provideTmpdirServer(
      ({ llm }) =>
        Effect.gen(function* () {
          const prompt = yield* SessionPrompt.Service
          const sessions = yield* Session.Service
          const parent = yield* sessions.create({ title: "parent session" })
          const child = yield* sessions.create({ title: "child session", parentID: parent.id })

          yield* llm.text("child response")
          yield* prompt.prompt({
            sessionID: child.id,
            agent: "build",
            parentAgent: "general",
            model: ref,
            parts: [{ type: "text", text: "child user" }],
          })

          const bodies = yield* llm.inputs
          const body = bodies.find((item) => JSON.stringify(item).includes("child user"))

          expect(JSON.stringify(body)).toContain(`parent=${parent.id}`)
          expect(JSON.stringify(body)).toContain("agent=build")
          expect(JSON.stringify(body)).toContain("parentAgent=general")
        }),
      { git: true, config: providerCfg },
    ),
  )
})
