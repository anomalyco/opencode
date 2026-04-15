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

test("prompt_async to busy session does not orphan user message", async () => {
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

            const uid1 = MessageID.ascending()
            yield* sessions.updateMessage({
              id: uid1,
              sessionID: session.id,
              role: "user",
              agent: "build",
              model: ref,
              time: { created: Date.now() },
            } satisfies MessageV2.User)
            yield* sessions.updatePart({
              id: PartID.ascending(),
              sessionID: session.id,
              messageID: uid1,
              type: "text",
              text: "first question",
            } satisfies MessageV2.TextPart)

            const aid = MessageID.ascending()
            yield* sessions.updateMessage({
              id: aid,
              sessionID: session.id,
              role: "assistant",
              parentID: uid1,
              agent: "build",
              mode: "build",
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
              text: "first answer",
            } satisfies MessageV2.TextPart)

            const uid2 = MessageID.ascending()
            yield* sessions.updateMessage({
              id: uid2,
              sessionID: session.id,
              role: "user",
              agent: "build",
              model: ref,
              time: { created: Date.now() },
            } satisfies MessageV2.User)
            yield* sessions.updatePart({
              id: PartID.ascending(),
              sessionID: session.id,
              messageID: uid2,
              type: "text",
              text: "second question (from prompt_async)",
            } satisfies MessageV2.TextPart)

            const result = yield* Effect.promise(() =>
              Promise.race([
                Effect.runPromise(prompt.loop({ sessionID: session.id })).then(() => "exited" as const),
                new Promise<"continued">((r) => setTimeout(() => r("continued"), 3000)),
              ]),
            )

            expect(result).toBe("continued")
          }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(SessionPrompt.defaultLayer, Session.defaultLayer))),
        ),
    }),
  )
}, 15000)
