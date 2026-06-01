import { expect, test } from "bun:test"
import { Effect } from "effect"
import * as DateTime from "effect/DateTime"
import { SessionID } from "../../src/session/schema"
import { EventV2 } from "@opencode-ai/core/event"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessageUpdater } from "@opencode-ai/core/session/message-updater"

test.skip("step snapshots carry over to assistant messages", () => {
  const state: SessionMessageUpdater.MemoryState = { messages: [] }
  const sessionID = SessionID.make("session")

  Effect.runSync(
    SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
      id: EventV2.ID.create(),
      type: "session.next.step.started",
      data: {
        sessionID,
        timestamp: DateTime.makeUnsafe(1),
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

  Effect.runSync(
    SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
      id: EventV2.ID.create(),
      type: "session.next.step.ended",
      data: {
        sessionID,
        timestamp: DateTime.makeUnsafe(2),
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

  Effect.runSync(
    SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
      id: EventV2.ID.create(),
      type: "session.next.step.started",
      data: {
        sessionID,
        timestamp: DateTime.makeUnsafe(1),
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
      type: "session.next.text.started",
      data: {
        sessionID,
        timestamp: DateTime.makeUnsafe(2),
      },
    } satisfies SessionEvent.Event),
  )

  Effect.runSync(
    SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
      id: EventV2.ID.create(),
      type: "session.next.text.ended",
      data: {
        sessionID,
        timestamp: DateTime.makeUnsafe(3),
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

  Effect.runSync(
    SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
      id: EventV2.ID.create(),
      type: "session.next.step.started",
      data: {
        sessionID,
        timestamp: DateTime.makeUnsafe(1),
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
      type: "session.next.tool.input.started",
      data: {
        sessionID,
        timestamp: DateTime.makeUnsafe(2),
        callID,
        name: "bash",
      },
    } satisfies SessionEvent.Event),
  )

  Effect.runSync(
    SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
      id: EventV2.ID.create(),
      type: "session.next.tool.called",
      data: {
        sessionID,
        timestamp: DateTime.makeUnsafe(3),
        callID,
        tool: "bash",
        input: { command: "pwd" },
        provider: { executed: true, metadata: { source: "provider" } },
      },
    } satisfies SessionEvent.Event),
  )

  Effect.runSync(
    SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
      id: EventV2.ID.create(),
      type: "session.next.tool.success",
      data: {
        sessionID,
        timestamp: DateTime.makeUnsafe(4),
        callID,
        structured: {},
        content: [{ type: "text", text: "/tmp" }],
        provider: { executed: true, metadata: { status: "done" } },
      },
    } satisfies SessionEvent.Event),
  )

  expect(state.messages[0]?.type).toBe("assistant")
  if (state.messages[0]?.type !== "assistant") return
  expect(state.messages[0].content[0]?.type).toBe("tool")
  if (state.messages[0].content[0]?.type !== "tool") return
  expect(state.messages[0].content[0].time.completed).toEqual(DateTime.makeUnsafe(4))
  expect(state.messages[0].content[0].provider).toEqual({ executed: true, metadata: { status: "done" } })
})

test.skip("compaction events reduce to compaction message", () => {
  const state: SessionMessageUpdater.MemoryState = { messages: [] }
  const sessionID = SessionID.make("session")
  const id = EventV2.ID.create()

  Effect.runSync(
    SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
      id,
      type: "session.next.compaction.started",
      data: {
        sessionID,
        timestamp: DateTime.makeUnsafe(1),
        reason: "auto",
      },
    } satisfies SessionEvent.Event),
  )

  Effect.runSync(
    SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
      id: EventV2.ID.create(),
      type: "session.next.compaction.delta",
      data: {
        sessionID,
        timestamp: DateTime.makeUnsafe(2),
        text: "hello ",
      },
    } satisfies SessionEvent.Event),
  )

  Effect.runSync(
    SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
      id: EventV2.ID.create(),
      type: "session.next.compaction.delta",
      data: {
        sessionID,
        timestamp: DateTime.makeUnsafe(3),
        text: "summary",
      },
    } satisfies SessionEvent.Event),
  )

  Effect.runSync(
    SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
      id: EventV2.ID.create(),
      type: "session.next.compaction.ended",
      data: {
        sessionID,
        timestamp: DateTime.makeUnsafe(4),
        text: "final summary",
        include: "recent context",
      },
    } satisfies SessionEvent.Event),
  )

  expect(state.messages).toHaveLength(1)
  expect(state.messages[0]).toMatchObject({
    id,
    type: "compaction",
    reason: "auto",
    summary: "final summary",
    include: "recent context",
    time: { created: DateTime.makeUnsafe(1) },
  })
})
