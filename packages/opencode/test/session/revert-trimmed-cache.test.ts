import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Session } from "@/session/session"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { SessionRevert } from "../../src/session/revert"
import * as Log from "@opencode-ai/core/util/log"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Snapshot } from "../../src/snapshot"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

void Log.init({ print: false })

const env = Layer.mergeAll(
  Session.defaultLayer,
  SessionRevert.defaultLayer,
  Snapshot.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
)

const it = testEffect(env)

const createUserMessage = Effect.fn("test.createUserMessage")(function* (sessionID: SessionID) {
  const session = yield* Session.Service
  return yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user" as const,
    sessionID,
    agent: "default",
    model: { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-4") },
    time: { created: Date.now() },
  })
})

const createAssistantMessage = Effect.fn("test.createAssistantMessage")(function* (
  sessionID: SessionID,
  parentID: MessageID,
  dir: string,
) {
  const session = yield* Session.Service
  return yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "assistant" as const,
    sessionID,
    mode: "default",
    agent: "default",
    path: { cwd: dir, root: dir },
    cost: 0,
    tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ModelID.make("gpt-4"),
    providerID: ProviderID.make("openai"),
    parentID,
    time: { created: Date.now() },
    finish: "end_turn",
  })
})

describe("revert with many messages", () => {
  it.live(
    "server-side revert works correctly with 100+ messages",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const session = yield* Session.Service
          const revert = yield* SessionRevert.Service

          const info = yield* session.create({})
          const sid = info.id

          // Create first user message U1 with a text part (revert requires parts)
          const u1 = yield* createUserMessage(sid)
          yield* session.updatePart({
            id: PartID.ascending(),
            messageID: u1.id,
            sessionID: sid,
            type: "text",
            text: "first message",
          })

          // Create an assistant message after U1
          let lastAssistant = yield* createAssistantMessage(sid, u1.id, dir)

          // Generate enough assistant messages to exceed 100 total entries
          for (let i = 0; i < 100; i++) {
            lastAssistant = yield* createAssistantMessage(sid, lastAssistant.id, dir)
          }

          // Now create second user message U2 with a text part
          const u2 = yield* createUserMessage(sid)
          yield* session.updatePart({
            id: PartID.ascending(),
            messageID: u2.id,
            sessionID: sid,
            type: "text",
            text: "second message",
          })
          yield* createAssistantMessage(sid, u2.id, dir)

          // Verify total message count exceeds 100
          const allMessages = yield* session.messages({ sessionID: sid })
          expect(allMessages.length).toBeGreaterThan(100)

          // Count user messages
          const userMessages = allMessages.filter((m) => m.info.role === "user")
          expect(userMessages.length).toBe(2)

          // Server-side revert should work regardless of message count
          yield* revert.revert({ sessionID: sid, messageID: u2.id })
          const sessionAfterFirstRevert = yield* session.get(sid)
          expect(sessionAfterFirstRevert.revert?.messageID).toBe(u2.id)

          // Revert to earlier user message
          yield* revert.revert({ sessionID: sid, messageID: u1.id })
          const sessionAfterSecondRevert = yield* session.get(sid)
          expect(sessionAfterSecondRevert.revert?.messageID).toBe(u1.id)

          // Unrevert back to initial state
          yield* revert.unrevert({ sessionID: sid })
          const sessionAfterUnrevert = yield* session.get(sid)
          expect(sessionAfterUnrevert.revert).toBeUndefined()
        }),
      { git: false },
    ),
    { timeout: 30000 },
  )
})
