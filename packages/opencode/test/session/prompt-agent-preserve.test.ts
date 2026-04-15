import { afterEach, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Instance } from "../../src/project/instance"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageID, PartID } from "../../src/session/schema"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

afterEach(async () => {
  await Instance.disposeAll()
})

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

async function withoutWatcher<T>(fn: () => Promise<T>) {
  if (process.platform !== "win32") return fn()
  const prev = process.env.OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER
  process.env.OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER = "true"
  try {
    return await fn()
  } finally {
    if (prev === undefined) delete process.env.OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER
    else process.env.OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER = prev
  }
}

test("prompt without agent field preserves session's current agent", async () => {
  await using tmp = await tmpdir({
    git: true,
    config: {
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
            baseURL: "http://localhost:1/v1",
          },
        },
      },
    },
  })
  await withoutWatcher(() =>
    Instance.provide({
      directory: tmp.path,
      fn: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const prompt = yield* SessionPrompt.Service
            const sessions = yield* Session.Service
            const session = yield* sessions.create({
              permission: [{ permission: "*", pattern: "*", action: "allow" }],
            })

            const uid = MessageID.ascending()
            yield* sessions.updateMessage({
              id: uid,
              sessionID: session.id,
              role: "user",
              agent: "plan",
              model: ref,
              time: { created: Date.now() },
            } satisfies MessageV2.User)
            yield* sessions.updatePart({
              id: PartID.ascending(),
              sessionID: session.id,
              messageID: uid,
              type: "text",
              text: "make a plan",
            } satisfies MessageV2.TextPart)

            const aid = MessageID.ascending()
            yield* sessions.updateMessage({
              id: aid,
              sessionID: session.id,
              role: "assistant",
              parentID: uid,
              agent: "plan",
              mode: "plan",
              cost: 0,
              path: { cwd: "/tmp", root: "/tmp" },
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              modelID: ref.modelID,
              providerID: ref.providerID,
              time: { created: Date.now() },
              finish: "stop",
            } satisfies MessageV2.Assistant)
            yield* sessions.updatePart({
              id: PartID.ascending(),
              sessionID: session.id,
              messageID: aid,
              type: "text",
              text: "here is the plan",
            } satisfies MessageV2.TextPart)

            const msg = yield* prompt.prompt({
              sessionID: session.id,
              noReply: true,
              parts: [{ type: "text", text: "notification: task completed" }],
            })

            expect(msg.info.role).toBe("user")
            if (msg.info.role === "user") {
              expect(msg.info.agent).toBe("plan")
            }
          }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(SessionPrompt.defaultLayer, Session.defaultLayer))),
        ),
    }),
  )
}, 15000)
