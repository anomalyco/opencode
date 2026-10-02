import { describe, expect, test } from "bun:test"
import { OpenCodeEvent, type OpenCodeEventEncoded } from "@opencode/protocol/groups/event"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { Schema } from "effect"
import { ACPTranslate } from "../../src/acp/translate"
import {
  childCreated,
  delivered,
  durableEvent,
  failed,
  interrupted,
  stepEnded,
  succeeded,
  textDelta,
  tokens,
  toolCalled,
  toolProgress,
  toolStarted,
} from "./wire-fixture"

const root = Session.ID.make("ses_root")
const ctx: ACPTranslate.Context = {
  sessionID: root,
  cwd: "/workspace",
  start: { type: "input", id: SessionMessage.ID.make("msg_input") },
  childUpdates: false,
  compaction: false,
  mode: "turn",
}

function run(events: ReadonlyArray<OpenCodeEventEncoded>, context = ctx, state = ACPTranslate.initial) {
  return events.reduce<{ state: ACPTranslate.TurnState; outputs: ACPTranslate.Output[]; terminal?: string }>(
    (acc, event, index) => {
      const next = ACPTranslate.step(acc.state, decodeEvent({ ...event, id: `evt_${index + 1}` }), context)
      return {
        state: next.state,
        outputs: [...acc.outputs, ...next.outputs],
        ...(next.terminal ? { terminal: next.terminal } : {}),
      }
    },
    { state, outputs: [] },
  )
}

const decodeEvent = Schema.decodeUnknownSync(OpenCodeEvent)

function started(...events: OpenCodeEventEncoded[]) {
  return run([delivered(root, "msg_input"), ...events])
}

function updates(outputs: ReadonlyArray<ACPTranslate.Output>) {
  return outputs.flatMap((output) => (output._tag === "SessionUpdate" ? [output.update] : []))
}

describe("acp turn translation", () => {
  test("ignores a session's events until its own input is delivered, and other sessions' events after", () => {
    const result = run([
      textDelta(root, "msg_early", "early"),
      delivered(root, "msg_other_input"),
      delivered("ses_other", "msg_input"),
      succeeded(root),
      delivered(root, "msg_input"),
      textDelta("ses_other", "msg_other", "other session"),
      textDelta(root, "msg_ok", "accepted"),
    ])

    expect(result.terminal).toBeUndefined()
    expect(updates(result.outputs)).toEqual([
      { sessionUpdate: "agent_message_chunk", messageId: "msg_ok", content: { type: "text", text: "accepted" } },
    ])
  })

  test("sums usage across steps, including a failed step, and keeps the last step for context", () => {
    const result = started(
      durableEvent("session.step.failed", {
        sessionID: root,
        assistantMessageID: "msg_1",
        error: { type: "provider.stream", message: "stream interrupted" },
        cost: 0,
        tokens: { ...tokens(), input: 40, output: 4 },
      }),
      durableEvent("session.step.started", {
        sessionID: root,
        assistantMessageID: "msg_2",
        agent: "build",
        model: { providerID: "test", id: "test-model" },
        started: 0,
      }),
      stepEnded(root, "msg_2", { finish: "length", tokens: { ...tokens(), input: 20, output: 7, reasoning: 2 } }),
    )

    expect(result.state.usage).toEqual({
      turn: { input: 60, output: 11, reasoning: 2, cache: { read: 0, write: 0 } },
      last: { input: 20, output: 7, reasoning: 2, cache: { read: 0, write: 0 } },
    })
    expect(ACPTranslate.failure(result.state)).toBeUndefined()
    expect(ACPTranslate.response(result.state, root, "succeeded")).toEqual({
      stopReason: "max_tokens",
      usage: { inputTokens: 60, outputTokens: 11, thoughtTokens: 2, totalTokens: 73 },
      _meta: {},
    })
  })

  test("marks a compaction that fails before starting, and drops an end with no start", () => {
    const result = started(
      durableEvent("session.compaction.failed", {
        sessionID: root,
        reason: "auto",
        error: { type: "compaction.unavailable", message: "Nothing to compact yet" },
      }),
      durableEvent("session.compaction.ended", { sessionID: root, reason: "auto", text: "summary", recent: "" }),
    )

    expect(updates(result.outputs).map((update) => update._meta?.["opencode/compaction"])).toEqual([
      {
        status: "failed",
        messageId: "msg_2",
        reason: "auto",
        error: { type: "compaction.unavailable", message: "Nothing to compact yet" },
      },
    ])
    expect(result.state.compactions.size).toBe(0)
  })

  test("projects a nested child's updates with its depth and its own parent", () => {
    const result = started(
      childCreated("ses_child", root, "Explore"),
      childCreated("ses_grandchild", "ses_child", "Deeper"),
      childCreated("ses_stranger", "ses_unknown", "Unrelated"),
      toolStarted("ses_grandchild", "call_1", "read"),
      textDelta("ses_stranger", "msg_stranger", "ignored"),
    )

    expect(updates(result.outputs)).toEqual([
      expect.objectContaining({
        sessionUpdate: "tool_call",
        toolCallId: "ses_grandchild:call_1",
        title: "Deeper: read",
        _meta: { "opencode/child-session": { id: "ses_grandchild", parentID: "ses_child", depth: 2, title: "Deeper" } },
      }),
    ])
    expect([...result.state.openChildren]).toEqual(["ses_child", "ses_grandchild"])
  })

  test("ends a background consumer when its last open child settles, without session updates", () => {
    const turn = started(childCreated("ses_a", root, "A"), childCreated("ses_b", root, "B"), succeeded(root))
    const background = { ...ctx, mode: "background" as const }
    const first = run(
      [textDelta(root, "msg_root", "ignored"), toolStarted("ses_a", "call_1", "read"), succeeded("ses_a")],
      background,
      turn.state,
    )
    const last = run([childCreated("ses_later", root, "Later"), interrupted("ses_b")], background, first.state)

    expect(turn.terminal).toBe("succeeded")
    expect(first.outputs).toEqual([])
    expect(first.terminal).toBeUndefined()
    expect(last.state.children.has("ses_later")).toBe(false)
    expect(last.terminal).toBe("interrupted")
  })

  test("fails the tools a cancelled turn left open, including a child's", () => {
    const result = started(
      childCreated("ses_child", root, "Explore"),
      toolStarted(root, "call_root", "shell"),
      toolCalled(root, "call_root", { command: "sleep 60" }),
      toolProgress(root, "call_root", { pid: 1 }),
      toolStarted("ses_child", "call_child", "read"),
      failed("ses_child", { type: "aborted", message: "interrupted" }),
    )

    const abandoned = ACPTranslate.abandon(result.state, ctx)

    expect(abandoned.state.tools.size).toBe(0)
    expect(updates(abandoned.outputs)).toEqual([
      expect.objectContaining({
        sessionUpdate: "tool_call_update",
        toolCallId: "call_root",
        status: "failed",
        rawInput: expect.objectContaining({ command: "sleep 60" }),
        rawOutput: { metadata: { pid: 1 }, error: "Cancelled" },
      }),
      expect.objectContaining({ toolCallId: "ses_child:call_child", status: "failed", title: "Explore: read" }),
    ])
    expect(ACPTranslate.abandon(abandoned.state, ctx).outputs).toEqual([])
  })
})
