import { expect, test } from "bun:test"
import { Effect } from "effect"
import * as DateTime from "effect/DateTime"
import { EventV2 } from "@opencode-ai/core/event"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessageUpdater } from "@opencode-ai/core/session/message-updater"
import { SessionID } from "../../src/session/schema"

const sessionID = SessionID.make("session")
const model = {
  id: ModelV2.ID.make("model"),
  providerID: ProviderV2.ID.make("provider"),
  variant: ModelV2.VariantID.make("default"),
}

function eventID(suffix: string) {
  return EventV2.ID.make(`evt_${suffix}`)
}

function applyEvents(events: SessionEvent.Event[]) {
  const state: SessionMessageUpdater.MemoryState = { messages: [] }
  for (const event of events) {
    Effect.runSync(SessionMessageUpdater.update(SessionMessageUpdater.memory(state), event))
  }
  return state
}

function canonicalStateStrings(state: SessionMessageUpdater.MemoryState) {
  const strings: string[] = []
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      strings.push(value)
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (value && typeof value === "object") {
      for (const item of Object.values(value)) visit(item)
    }
  }
  visit(state)
  return strings
}

test("v2 message entities use creating evt_* IDs", () => {
  const promptedID = eventID("prompted")
  const assistantID = eventID("assistant_started")
  const shellID = eventID("shell_started")
  const compactionID = eventID("compaction_started")

  const state = applyEvents([
    {
      id: promptedID,
      type: "session.next.prompted",
      data: {
        sessionID,
        timestamp: DateTime.makeUnsafe(1),
        prompt: { text: "hello", files: [], agents: [], references: [] },
      },
    },
    {
      id: assistantID,
      type: "session.next.step.started",
      data: {
        sessionID,
        timestamp: DateTime.makeUnsafe(2),
        agent: "build",
        model,
      },
    },
    {
      id: shellID,
      type: "session.next.shell.started",
      data: {
        sessionID,
        timestamp: DateTime.makeUnsafe(3),
        callID: "shell-call",
        command: "pwd",
      },
    },
    {
      id: compactionID,
      type: "session.next.compaction.started",
      data: {
        sessionID,
        timestamp: DateTime.makeUnsafe(4),
        reason: "auto",
      },
    },
  ] satisfies SessionEvent.Event[])

  expect(state.messages.map((message) => message.id)).toEqual([promptedID, assistantID, shellID, compactionID])
  for (const message of state.messages) {
    expect(message.id.startsWith("evt_")).toBe(true)
  }
})

test("assistant durable content uses event-derived stable IDs across independent replays", () => {
  const assistantID = eventID("assistant_started")
  const textID = eventID("text_started")
  const reasoningID = eventID("reasoning_started")
  const toolID = eventID("tool_input_started")

  const events = [
    {
      id: assistantID,
      type: "session.next.step.started",
      data: {
        sessionID,
        timestamp: DateTime.makeUnsafe(1),
        agent: "build",
        model,
      },
    },
    {
      id: textID,
      type: "session.next.text.started",
      data: { sessionID, timestamp: DateTime.makeUnsafe(2) },
    },
    {
      id: eventID("text_delta"),
      type: "session.next.text.delta",
      data: { sessionID, timestamp: DateTime.makeUnsafe(3), delta: "hello " },
    },
    {
      id: eventID("text_ended"),
      type: "session.next.text.ended",
      data: { sessionID, timestamp: DateTime.makeUnsafe(4), text: "hello assistant" },
    },
    {
      id: reasoningID,
      type: "session.next.reasoning.started",
      data: { sessionID, timestamp: DateTime.makeUnsafe(5), reasoningID: "reasoning-external" },
    },
    {
      id: eventID("reasoning_ended"),
      type: "session.next.reasoning.ended",
      data: {
        sessionID,
        timestamp: DateTime.makeUnsafe(6),
        reasoningID: "reasoning-external",
        text: "because",
      },
    },
    {
      id: toolID,
      type: "session.next.tool.input.started",
      data: { sessionID, timestamp: DateTime.makeUnsafe(7), callID: "call-external", name: "bash" },
    },
    {
      id: eventID("tool_called"),
      type: "session.next.tool.called",
      data: {
        sessionID,
        timestamp: DateTime.makeUnsafe(8),
        callID: "call-external",
        tool: "bash",
        input: { command: "pwd" },
        provider: { executed: true },
      },
    },
    {
      id: eventID("tool_success"),
      type: "session.next.tool.success",
      data: {
        sessionID,
        timestamp: DateTime.makeUnsafe(9),
        callID: "call-external",
        structured: {},
        content: [{ type: "text", text: "/tmp" }],
        provider: { executed: true, metadata: { status: "done" } },
      },
    },
  ] satisfies SessionEvent.Event[]

  const first = applyEvents(events)
  const replayed = applyEvents(events)

  expect(replayed).toEqual(first)
  expect(first.messages[0]?.type).toBe("assistant")
  if (first.messages[0]?.type !== "assistant") return

  expect(first.messages[0].id).toBe(assistantID)
  expect(first.messages[0].content).toMatchObject([
    { type: "text", id: textID, text: "hello assistant" },
    { type: "reasoning", id: reasoningID, reasoningID: "reasoning-external", text: "because" },
    {
      type: "tool",
      id: toolID,
      callID: "call-external",
      name: "bash",
      time: { created: DateTime.makeUnsafe(7), ran: DateTime.makeUnsafe(8), completed: DateTime.makeUnsafe(9) },
    },
  ])

  for (const value of canonicalStateStrings(first)) {
    expect(value.startsWith("msg_")).toBe(false)
    expect(value.startsWith("prt_")).toBe(false)
  }
})

test("step ended carries finish, snapshot, and token usage onto current assistant", () => {
  const assistantID = eventID("assistant_started")
  const endedID = eventID("step_ended")
  const tokens = {
    input: 11,
    output: 22,
    reasoning: 3,
    cache: { read: 4, write: 5 },
  }

  const state = applyEvents([
    {
      id: assistantID,
      type: "session.next.step.started",
      data: {
        sessionID,
        timestamp: DateTime.makeUnsafe(1),
        agent: "build",
        model,
        snapshot: "snapshot-start",
      },
    },
    {
      id: endedID,
      type: "session.next.step.ended",
      data: {
        sessionID,
        timestamp: DateTime.makeUnsafe(2),
        finish: "stop",
        cost: 0.25,
        tokens,
        snapshot: "snapshot-end",
      },
    },
  ] satisfies SessionEvent.Event[])

  expect(state.messages).toHaveLength(1)
  const assistant = state.messages[0]
  expect(assistant?.type).toBe("assistant")
  if (assistant?.type !== "assistant") return

  expect(assistant.id).toBe(assistantID)
  expect(assistant.finish).toBe("stop")
  expect(assistant.cost).toBe(0.25)
  expect(assistant.tokens).toEqual(tokens)
  expect(assistant.snapshot).toEqual({ start: "snapshot-start", end: "snapshot-end" })
  expect(assistant.time.completed).toEqual(DateTime.makeUnsafe(2))
})

test("compaction delta and ended reduce summary and include", () => {
  const compactionID = eventID("compaction_started")
  const events = [
    {
      id: compactionID,
      type: "session.next.compaction.started",
      data: {
        sessionID,
        timestamp: DateTime.makeUnsafe(1),
        reason: "manual",
      },
    },
    {
      id: eventID("compaction_delta_1"),
      type: "session.next.compaction.delta",
      data: { sessionID, timestamp: DateTime.makeUnsafe(2), text: "partial " },
    },
    {
      id: eventID("compaction_delta_2"),
      type: "session.next.compaction.delta",
      data: { sessionID, timestamp: DateTime.makeUnsafe(3), text: "summary" },
    },
    {
      id: eventID("compaction_ended"),
      type: "session.next.compaction.ended",
      data: {
        sessionID,
        timestamp: DateTime.makeUnsafe(4),
        text: "final summary",
        include: "keep this context",
      },
    },
  ] satisfies SessionEvent.Event[]

  const deltaState = applyEvents(events.slice(0, 3))
  const deltaCompaction = deltaState.messages[0]
  expect(deltaCompaction?.type).toBe("compaction")
  if (deltaCompaction?.type !== "compaction") return
  expect(deltaCompaction.summary).toBe("partial summary")

  const state = applyEvents(events)

  expect(state.messages).toHaveLength(1)
  const compaction = state.messages[0]
  expect(compaction?.type).toBe("compaction")
  if (compaction?.type !== "compaction") return

  expect(compaction.id).toBe(compactionID)
  expect(compaction.reason).toBe("manual")
  expect(compaction.summary).toBe("final summary")
  expect(compaction.include).toBe("keep this context")
})
