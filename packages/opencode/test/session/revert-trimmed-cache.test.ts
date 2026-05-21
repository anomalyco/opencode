import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Session } from "@/session/session"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { SessionRevert } from "../../src/session/revert"
import { SessionMessages } from "../../src/session/messages"
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
  SessionMessages.defaultLayer,
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

const createToolPart = Effect.fn("test.createToolPart")(function* (sessionID: SessionID, messageID: MessageID) {
  const session = yield* Session.Service
  return yield* session.updatePart({
    id: PartID.ascending(),
    messageID,
    sessionID,
    type: "tool" as const,
    tool: "bash",
    callID: `call-${Date.now()}`,
    state: {
      status: "completed" as const,
      input: {},
      output: "done",
      title: "",
      metadata: {},
      time: { start: 0, end: 1 },
    },
  })
})

describe("revert with trimmed message cache scenario", () => {
  it.instance(
    "should find and revert to earlier user messages when session has 100+ messages",
    () =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const revert = yield* SessionRevert.Service
        const messages = yield* SessionMessages.Service
        const testInstance = yield* import("../fixture/fixture").then((m) => m.TestInstance)

        const sid = SessionID.ascending()
        yield* session.create({
          id: sid,
          workspaceID: testInstance.workspaceID,
        })

        // Create first user message U1
        const u1 = yield* createUserMessage(sid)

        // Create an assistant message after U1
        const a1 = yield* createAssistantMessage(sid, u1.id, testInstance.directory)
        yield* createToolPart(sid, a1.id)

        // Generate enough assistant messages to exceed 100 total entries
        // Each iteration: 1 assistant + 1 tool part = 2 entries
        let lastAssistant = a1
        for (let i = 0; i < 60; i++) {
          const nextA = yield* createAssistantMessage(sid, lastAssistant.id, testInstance.directory)
          yield* createToolPart(sid, nextA.id)
          lastAssistant = nextA
        }

        // Now create second user message U2
        const u2 = yield* createUserMessage(sid)
        const u2Assistant = yield* createAssistantMessage(sid, u2.id, testInstance.directory)

        // Verify total message count exceeds 100
        const allMessages = yield* messages.list({ sessionID: sid })
        expect(allMessages.length).toBeGreaterThan(100)

        // Count user messages
        const userMessages = allMessages.filter((m) => m.role === "user")
        expect(userMessages.length).toBe(2)

        // First revert: should find U2 (last user message)
        yield* revert.revert({ sessionID: sid, messageID: u2.id })
        const sessionAfterFirstRevert = yield* session.get(sid)
        expect(sessionAfterFirstRevert.revert?.messageID).toBe(u2.id)

        // Second revert: should find U1 (the earlier user message)
        yield* revert.revert({ sessionID: sid, messageID: u1.id })
        const sessionAfterSecondRevert = yield* session.get(sid)
        expect(sessionAfterSecondRevert.revert?.messageID).toBe(u1.id)

        // Unrevert to U2
        yield* revert.unrevert({ sessionID: sid })
        const sessionAfterUnrevert = yield* session.get(sid)
        expect(sessionAfterUnrevert.revert?.messageID).toBe(u2.id)
      }),
  )
})
