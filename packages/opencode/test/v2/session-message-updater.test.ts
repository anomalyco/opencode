import { expect, test } from "bun:test"
import { DateTime, Effect } from "effect"
import { SessionID } from "../../src/session/schema"
import { EventV2 } from "@opencode-ai/core/event"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessageUpdater } from "@opencode-ai/core/session/message-updater"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { Agent } from "@opencode-ai/schema/agent"
import { Money } from "@opencode-ai/schema/money"
import { Snapshot } from "@opencode-ai/schema/snapshot"

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
        agent: Agent.ID.make("build"),
        model: {
          id: ModelV2.ID.make("model"),
          providerID: ProviderV2.ID.make("provider"),
          variant: ModelV2.VariantID.make("default"),
        },
        snapshot: Snapshot.ID.make("before"),
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
        cost: Money.USD.zero,
        tokens: {
          input: 1,
          output: 2,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
        snapshot: Snapshot.ID.make("after"),
      },
    } satisfies SessionEvent.Event),
  )

  expect(state.messages[0]?.type).toBe("assistant")
  if (state.messages[0]?.type !== "assistant") return
  expect(state.messages[0].snapshot).toEqual({
    start: Snapshot.ID.make("before"),
    end: Snapshot.ID.make("after"),
  })
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
        agent: Agent.ID.make("build"),
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
        ordinal: 0,
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
        ordinal: 0,
        text: "hello assistant",
      },
    } satisfies SessionEvent.Event),
  )

  expect(state.messages[0]?.type).toBe("assistant")
  if (state.messages[0]?.type !== "assistant") return
  expect(state.messages[0].content).toEqual([{ type: "text", text: "hello assistant" }])
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
        agent: Agent.ID.make("build"),
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
        input: { command: "pwd" },
        executed: true,
        state: { source: "provider" },
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
        executed: true,
        resultState: { status: "done" },
      },
    } satisfies SessionEvent.Event),
  )

  expect(state.messages[0]?.type).toBe("assistant")
  if (state.messages[0]?.type !== "assistant") return
  expect(state.messages[0].content[0]?.type).toBe("tool")
  if (state.messages[0].content[0]?.type !== "tool") return
  expect(state.messages[0].content[0].time.completed).toEqual(DateTime.makeUnsafe(4))
  expect(state.messages[0].content[0]).toMatchObject({
    executed: true,
    providerState: { source: "provider" },
    providerResultState: { status: "done" },
  })
})

test("compaction events reduce to a compaction message through completion", () => {
  const state: SessionMessageUpdater.MemoryState = { messages: [] }
  const sessionID = SessionID.make("session")
  const id = EventV2.ID.create()
  const endedID = EventV2.ID.create()

  Effect.runSync(
    SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
      id,
      created: DateTime.makeUnsafe(0),
      type: "session.compaction.started",
      durable: durable(sessionID, 0, 2),
      data: {
        sessionID,
        reason: "auto",
        recent: "recent context",
      },
    } satisfies SessionEvent.Event),
  )

  expect(state.messages).toMatchObject([
    {
      id: SessionMessage.ID.fromEvent(id),
      type: "compaction",
      reason: "auto",
      recent: "recent context",
      status: "running",
      summary: "",
    },
  ])

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
      durable: durable(sessionID, 3),
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
    id: SessionMessage.ID.fromEvent(id),
    type: "compaction",
    reason: "auto",
    status: "completed",
    summary: "final summary",
    recent: "recent context",
    time: { created: DateTime.makeUnsafe(0) },
  })
})
