import { afterAll, beforeAll, beforeEach, describe, expect } from "bun:test"
import { Effect, Fiber } from "effect"
import z from "zod"
import { ProviderID, ModelID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageID, PartID } from "../../src/session/schema"
import { Tool } from "../../src/tool/tool"
import { ToolRegistry } from "../../src/tool/registry"
import { Log } from "../../src/util/log"
import { server, waitRequest, toolResponse, textResponse, deferred } from "../fixture/anthropic"
import { env } from "../fixture/prompt-layers"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

Log.init({ print: false })

beforeAll(() => server.start())
beforeEach(() => server.reset())
afterAll(() => server.stop())

const it = testEffect(env)

describe("session.processor.metadata-race", () => {
  it.effect(
    "ctx.metadata() survives pending→running transition through full prompt pipeline",
    () =>
      provideTmpdirInstance(
        (_dir) =>
          Effect.gen(function* () {
            const signal = deferred<void>()
            const gate = deferred<void>()

            // 1. Register custom tool that calls ctx.metadata()
            const reg = yield* ToolRegistry.Service
            yield* reg.register(
              Tool.define("test_metadata", {
                description: "Test tool for metadata race",
                parameters: z.object({ key: z.string() }),
                async execute(_args, ctx) {
                  ctx.metadata({ title: "test-task", metadata: { sessionId: "sess-123" } })
                  signal.resolve()
                  await gate.promise
                  return { title: "test-task", metadata: {}, output: "done" }
                },
              }),
            )

            // 2. Create session with non-default title (suppresses title generation fork)
            const sessions = yield* Session.Service
            const chat = yield* sessions.create({ title: "Pinned" })

            // 3. Create user message with anthropic model ref
            const ref = {
              providerID: ProviderID.make("anthropic"),
              modelID: ModelID.make("claude-3-5-sonnet-20241022"),
            }
            const parent = yield* sessions.updateMessage({
              id: MessageID.ascending(),
              role: "user",
              sessionID: chat.id,
              agent: "build",
              model: ref,
              time: { created: Date.now() },
            })
            yield* sessions.updatePart({
              id: PartID.ascending(),
              messageID: parent.id,
              sessionID: chat.id,
              type: "text",
              text: "call test_metadata",
            })

            // 4. Queue SSE responses: tool_use then text (for second loop iteration)
            waitRequest("/messages", toolResponse("toolu_01", "test_metadata", { key: "value" }))
            waitRequest("/messages", textResponse("Done"))

            // 5. Fork prompt.loop on background fiber
            const prompt = yield* SessionPrompt.Service
            const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)

            // 6. Wait for tool execute to call ctx.metadata()
            yield* Effect.promise(() => signal.promise)

            // 7. Poll DB until tool part reaches running state
            const deadline = Date.now() + 5_000
            let tp: MessageV2.ToolPart | undefined
            while (Date.now() < deadline) {
              const msgs = yield* Effect.promise(() => MessageV2.filterCompacted(MessageV2.stream(chat.id)))
              for (const m of msgs) {
                if (m.info.role !== "assistant") continue
                for (const p of m.parts) {
                  if (p.type === "tool" && p.tool === "test_metadata" && p.state.status === "running") {
                    tp = p as MessageV2.ToolPart
                  }
                }
              }
              if (tp) break
              yield* Effect.promise(() => new Promise<void>((r) => setTimeout(r, 10)))
            }

            // 8. Assert: metadata must survive pending→running transition
            expect(tp).toBeDefined()
            expect(tp!.state.status).toBe("running")
            const running = tp!.state as MessageV2.ToolStateRunning
            expect(running.metadata).toBeDefined()
            expect(running.metadata?.sessionId).toBe("sess-123")

            // 9. Release gate to let tool complete
            gate.resolve()

            // 10. Wait for prompt.loop to finish
            yield* Fiber.join(fiber)
          }),
        {
          git: true,
          config: {
            provider: {
              anthropic: {
                options: {
                  apiKey: "test-key",
                  baseURL: `${server.origin}/v1`,
                },
              },
            },
          },
        },
      ),
    60_000,
  )
})
