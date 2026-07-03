import { expect, test } from "bun:test"
import { Effect } from "effect"
import * as DateTime from "effect/DateTime"
import { SessionID } from "../../src/session/schema"
import { EventV2 } from "@opencode-ai/core/event"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessageUpdater } from "@opencode-ai/core/session/message-updater"
import { SessionMessage } from "@opencode-ai/core/session/message"

function durable(sessionID: SessionID, seq = 0, version = 1) {
  return { aggregateID: sessionID, seq: EventV2.Seq.make(seq), version: EventV2.Version.make(version) }
}

test.skip("step snapshots carry over to assistant messages", () => {
  const state: SessionMessageUpdater.MemoryState = { messages: [] }
  const sessionID = SessionID.make("session")
  const assistantMessageID = SessionMessage.ID.create()

  Effect.runSync(
    SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
      id: EventV2.ID.create(),
      created: DateTime.makeUnsafe(0),
      type: "session.step.started",
      durable: durable(sessionID),
      data: {
        sessionID,
        assistantMessageID,
        agent: "build",
        model: {
          id: ModelV2.ID.make("model"),
          providerID: ProviderV2.ID.make("provider"),
          variant: ModelV2.VariantID.make("default"),
        },
        snapshot: "before",
      },
    } satisfies SessionEvent.Event),
  )

  expect(state.messages).toEqual([])

  Effect.runSync(
    SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
      id: EventV2.ID.create(),
      created: DateTime.makeUnsafe(0),
      type: "session.step.ended",
      durable: durable(sessionID, 1, 2),
      data: {
        sessionID,
        assistantMessageID,
        finish: "stop",
        cost: 0,
        tokens: {
          input: 1,
          output: 2,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
        snapshot: "after",
      },
    } satisfies SessionEvent.Event),
  )

  expect(state.messages[0]?.type).toBe("assistant")
  if (state.messages[0]?.type !== "assistant") return
  expect(state.messages[0].snapshot).toEqual({ start: "before", end: "after" })
  expect(state.messages[0].finish).toBe("stop")
})

test.skip("text ended populates assistant text content", () => {
  const state: SessionMessageUpdater.MemoryState = { messages: [] }
  const sessionID = SessionID.make("session")
  const assistantMessageID = SessionMessage.ID.create()

  Effect.runSync(
    SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
      id: EventV2.ID.create(),
      created: DateTime.makeUnsafe(0),
      type: "session.step.started",
      durable: durable(sessionID),
      data: {
        sessionID,
        assistantMessageID,
        agent: "build",
        model: {
          id: ModelV2.ID.make("model"),
          providerID: ProviderV2.ID.make("provider"),
          variant: ModelV2.VariantID.make("default"),
        },
      },
    } satisfies SessionEvent.Event),
  )

  Effect.runSync(
    SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
      id: EventV2.ID.create(),
      created: DateTime.makeUnsafe(0),
      type: "session.text.started",
      durable: durable(sessionID, 1),
      data: {
        sessionID,
        assistantMessageID,
        textID: "text-1",
      },
    } satisfies SessionEvent.Event),
  )

  Effect.runSync(
    SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
      id: EventV2.ID.create(),
      created: DateTime.makeUnsafe(0),
      type: "session.text.ended",
      durable: durable(sessionID, 2),
      data: {
        sessionID,
        assistantMessageID,
        textID: "text-1",
        text: "hello assistant",
      },
    } satisfies SessionEvent.Event),
  )

  expect(state.messages[0]?.type).toBe("assistant")
  if (state.messages[0]?.type !== "assistant") return
  expect(state.messages[0].content).toEqual([{ type: "text", id: "text-1", text: "hello assistant" }])
})

test.skip("tool completion stores completed timestamp", () => {
  const state: SessionMessageUpdater.MemoryState = { messages: [] }
  const sessionID = SessionID.make("session")
  const callID = "call"
  const assistantMessageID = SessionMessage.ID.create()

  Effect.runSync(
    SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
      id: EventV2.ID.create(),
      created: DateTime.makeUnsafe(0),
      type: "session.step.started",
      durable: durable(sessionID),
      data: {
        sessionID,
        assistantMessageID,
        agent: "build",
        model: {
          id: ModelV2.ID.make("model"),
          providerID: ProviderV2.ID.make("provider"),
          variant: ModelV2.VariantID.make("default"),
        },
      },
    } satisfies SessionEvent.Event),
  )

  Effect.runSync(
    SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
      id: EventV2.ID.create(),
      created: DateTime.makeUnsafe(0),
      type: "session.tool.input.started",
      durable: durable(sessionID, 1),
      data: {
        sessionID,
        assistantMessageID,
        callID,
        name: "bash",
      },
    } satisfies SessionEvent.Event),
  )

  Effect.runSync(
    SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
      id: EventV2.ID.create(),
      created: DateTime.makeUnsafe(0),
      type: "session.tool.called",
      durable: durable(sessionID, 2),
      data: {
        sessionID,
        assistantMessageID,
        callID,
        tool: "bash",
        input: { command: "pwd" },
        provider: { executed: true, metadata: { fake: { source: "provider" } } },
      },
    } satisfies SessionEvent.Event),
  )

  Effect.runSync(
    SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
      id: EventV2.ID.create(),
      created: DateTime.makeUnsafe(0),
      type: "session.tool.success",
      durable: durable(sessionID, 3),
      data: {
        sessionID,
        assistantMessageID,
        callID,
        structured: {},
        content: [{ type: "text", text: "/tmp" }],
        provider: { executed: true, metadata: { fake: { status: "done" } } },
      },
    } satisfies SessionEvent.Event),
  )

  expect(state.messages[0]?.type).toBe("assistant")
  if (state.messages[0]?.type !== "assistant") return
  expect(state.messages[0].content[0]?.type).toBe("tool")
  if (state.messages[0].content[0]?.type !== "tool") return
  expect(state.messages[0].content[0].time.completed).toEqual(DateTime.makeUnsafe(4))
  expect(state.messages[0].content[0].provider).toEqual({ executed: true, metadata: { fake: { status: "done" } } })
})

test("compaction events reduce to compaction message only when completed", () => {
  const state: SessionMessageUpdater.MemoryState = { messages: [] }
  const sessionID = SessionID.make("session")
  const id = EventV2.ID.create()
  const endedID = EventV2.ID.create()

  Effect.runSync(
    SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
      id,
      created: DateTime.makeUnsafe(0),
      type: "session.compaction.started",
      durable: durable(sessionID),
      data: {
        sessionID,
        reason: "auto",
      },
    } satisfies SessionEvent.Event),
  )

  expect(state.messages).toEqual([])

  Effect.runSync(
    SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
      id: EventV2.ID.create(),
      created: DateTime.makeUnsafe(0),
      type: "session.compaction.delta",
      data: {
        sessionID,
        text: "hello ",
      },
    } satisfies SessionEvent.Event),
  )

  Effect.runSync(
    SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
      id: EventV2.ID.create(),
      created: DateTime.makeUnsafe(0),
      type: "session.compaction.delta",
      data: {
        sessionID,
        text: "summary",
      },
    } satisfies SessionEvent.Event),
  )

  Effect.runSync(
    SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
      id: endedID,
      created: DateTime.makeUnsafe(0),
      type: "session.compaction.ended",
      durable: durable(sessionID, 1),
      data: {
        sessionID,
        reason: "auto",
        text: "final summary",
        recent: "recent context",
      },
    } satisfies SessionEvent.Event),
  )

  expect(state.messages).toHaveLength(1)
  expect(state.messages[0]).toMatchObject({
    id: SessionMessage.ID.fromEvent(endedID),
    type: "compaction",
    reason: "auto",
    summary: "final summary",
    recent: "recent context",
    time: { created: DateTime.makeUnsafe(0) },
  })
})
