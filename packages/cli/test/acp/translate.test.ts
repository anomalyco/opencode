import { describe, expect, test } from "bun:test"
import type { OpenCodeEvent } from "@opencode/client/promise"
import { ACPTranslate } from "../../src/acp/translate"
import {
  assistantMessage,
  childCreated,
  delivered,
  durableEvent,
  ephemeralEvent,
  failed,
  interrupted,
  permissionAsked,
  stepEnded,
  succeeded,
  textDelta,
  tokens,
  toolCalled,
  toolFailed,
  toolProgress,
  toolStarted,
  toolSucceeded,
} from "./wire-fixture"

const root = "ses_root"
const ctx: ACPTranslate.Context = {
  sessionID: root,
  cwd: "/workspace",
  start: { type: "input", id: "msg_input" },
  childUpdates: false,
  mode: "turn",
}

function run(events: ReadonlyArray<OpenCodeEvent>, context = ctx, state = ACPTranslate.initial) {
  return events.reduce<{ state: ACPTranslate.TurnState; outputs: ACPTranslate.Output[]; terminal?: string }>(
    (acc, event, index) => {
      const next = ACPTranslate.step(acc.state, { ...event, id: `evt_${index + 1}` }, context)
      return {
        state: next.state,
        outputs: [...acc.outputs, ...next.outputs],
        ...(next.terminal ? { terminal: next.terminal } : {}),
      }
    },
    { state, outputs: [] },
  )
}

function started(...events: OpenCodeEvent[]) {
  return run([delivered(root, "msg_input"), ...events])
}

function updates(outputs: ReadonlyArray<ACPTranslate.Output>) {
  return outputs.flatMap((output) => (output._tag === "SessionUpdate" ? [output.update] : []))
}

describe("acp turn translation", () => {
  test("ignores events before the turn's own start and from other sessions", () => {
    const result = run([
      textDelta(root, "msg_early", "early"),
      delivered(root, "msg_other_input"),
      textDelta(root, "msg_wrong", "wrong input"),
      delivered("ses_other", "msg_input"),
      delivered(root, "msg_input"),
      textDelta("ses_other", "msg_other", "other session"),
      textDelta(root, "msg_ok", "accepted"),
    ])

    expect(result.state.started).toBe(true)
    expect(updates(result.outputs)).toEqual([
      { sessionUpdate: "agent_message_chunk", messageId: "msg_ok", content: { type: "text", text: "accepted" } },
    ])
  })

  test("tracks a tool from pending through success and forgets it afterwards", () => {
    const result = started(
      toolStarted(root, "call_1", "shell"),
      toolCalled(root, "call_1", { command: "pwd" }),
      toolProgress(root, "call_1", { phase: 1 }),
      toolSucceeded(root, "call_1", { exit: 0 }, "/workspace"),
    )

    expect(
      updates(result.outputs).map((update) => [update.sessionUpdate, "status" in update && update.status]),
    ).toEqual([
      ["tool_call", "pending"],
      ["tool_call_update", "in_progress"],
      ["tool_call_update", "in_progress"],
      ["tool_call_update", "completed"],
    ])
    expect(updates(result.outputs)[1]).toMatchObject({ title: "pwd", rawInput: { command: "pwd" } })
    expect(updates(result.outputs)[3]).toMatchObject({ rawOutput: { metadata: { exit: 0 } } })
    expect(result.state.tools.size).toBe(0)
  })

  test("fails a tool with the metadata last reported by progress", () => {
    const result = started(
      toolStarted(root, "call_1", "read"),
      toolCalled(root, "call_1", { path: "/workspace/a.ts" }),
      toolProgress(root, "call_1", { bytes: 3 }),
      toolFailed(root, "call_1", { error: { type: "tool.error", message: "boom" } }),
    )

    expect(updates(result.outputs).at(-1)).toMatchObject({
      sessionUpdate: "tool_call_update",
      status: "failed",
      rawOutput: { metadata: { bytes: 3 }, error: "boom" },
    })
    expect(result.state.tools.size).toBe(0)
  })

  test("reports a scheduled retry and clears it when the next step starts", () => {
    const retry = durableEvent("session.retry.scheduled", {
      sessionID: root,
      assistantMessageID: "msg_retry",
      attempt: 2,
      at: Date.UTC(2026, 0, 1),
      error: { type: "provider.rate-limit", message: "slow down" },
    })
    const pending = started(retry)
    const cleared = run([stepStarted(root)], ctx, pending.state)

    expect(updates(pending.outputs)).toEqual([
      {
        sessionUpdate: "session_info_update",
        _meta: {
          "opencode/retry": {
            attempt: 2,
            nextRetryAt: "2026-01-01T00:00:00.000Z",
            error: { type: "provider.rate-limit", message: "slow down" },
          },
        },
      },
    ])
    expect(ACPTranslate.response(pending.state, root, "interrupted", true)._meta).toEqual({
      "opencode/retry": expect.objectContaining({ attempt: 2 }),
    })
    expect(updates(cleared.outputs)).toEqual([
      { sessionUpdate: "session_info_update", _meta: { "opencode/retry": null } },
    ])
    expect(ACPTranslate.response(cleared.state, root, "succeeded", false)._meta).toEqual({})
  })

  test("projects child updates onto the parent turn without the child capability", () => {
    const result = started(
      childCreated("ses_child", root, "Explore"),
      toolStarted("ses_child", "call_1", "read"),
      stepEnded("ses_child", "msg_child", { tokens: tokens(50) }),
    )

    expect(result.outputs).toEqual([
      {
        _tag: "SessionUpdate",
        update: expect.objectContaining({
          sessionUpdate: "tool_call",
          toolCallId: "ses_child:call_1",
          title: "Explore: read",
          _meta: { "opencode/child-session": { id: "ses_child", parentID: root, depth: 1, title: "Explore" } },
        }),
      },
    ])
    expect(result.state.usage).toBeUndefined()
  })

  test("routes nested child updates and statuses to the extension with the child capability", () => {
    const result = run(
      [
        delivered(root, "msg_input"),
        childCreated("ses_child", root, "Explore"),
        childCreated("ses_grandchild", "ses_child", "Deeper"),
        textDelta("ses_grandchild", "msg_deep", "nested"),
        failed("ses_grandchild", { type: "tool.error", message: "boom" }),
      ],
      { ...ctx, childUpdates: true },
    )

    expect(updates(result.outputs)).toEqual([])
    expect(
      result.outputs.map((output) =>
        output._tag === "ChildUpdate"
          ? [
              output.update.childSessionId,
              output.update.depth,
              output.update.type === "status" ? output.update.status : output.update.update.sessionUpdate,
            ]
          : output._tag,
      ),
    ).toEqual([
      ["ses_child", 1, "created"],
      ["ses_grandchild", 2, "created"],
      ["ses_grandchild", 2, "agent_message_chunk"],
      ["ses_grandchild", 2, "failed"],
    ])
    expect([...result.state.openChildren]).toEqual(["ses_child"])
    expect(result.terminal).toBeUndefined()
  })

  test("asks child permissions with the child's tool and cancels forms before the turn starts", () => {
    const result = run([
      delivered(root, "msg_input"),
      childCreated("ses_child", root, "Explore"),
      toolStarted("ses_child", "call_1", "read"),
      toolCalled("ses_child", "call_1", { path: "/workspace/a.ts" }),
      permissionAsked("ses_child", "perm_1", { source: { type: "tool", messageID: "msg_child", id: "call_1" } }),
      permissionAsked("ses_other", "perm_other"),
    ])
    const form = run([
      ephemeralEvent("form.created", {
        form: {
          id: "frm_1",
          sessionID: root,
          title: "Question",
          metadata: {},
          fields: [{ key: "q0", title: "Choice", type: "string" }],
        },
      }),
    ])

    expect(result.outputs.filter((output) => output._tag === "PermissionAsk")).toEqual([
      {
        _tag: "PermissionAsk",
        event: expect.objectContaining({ data: expect.objectContaining({ id: "perm_1" }) }),
        tool: { name: "read", input: { path: "/workspace/a.ts" }, metadata: {} },
        child: { id: "ses_child", parentID: root, depth: 1, title: "Explore" },
      },
    ])
    expect(form.outputs).toEqual([{ _tag: "FormCancel", sessionID: root, formID: "frm_1" }])
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
      stepStarted(root),
      stepEnded(root, "msg_2", { finish: "length", tokens: { ...tokens(), input: 20, output: 7, reasoning: 2 } }),
    )

    expect(result.state.usage).toEqual({
      turn: { input: 60, output: 11, reasoning: 2, cache: { read: 0, write: 0 } },
      last: { input: 20, output: 7, reasoning: 2, cache: { read: 0, write: 0 } },
    })
    expect(result.state.stepError).toBeUndefined()
    expect(ACPTranslate.response(result.state, root, "succeeded", false)).toEqual({
      stopReason: "max_tokens",
      usage: { inputTokens: 60, outputTokens: 11, thoughtTokens: 2, totalTokens: 73 },
      _meta: {},
    })
  })

  test("marks compactions with stable message IDs, including a failure before any start", () => {
    const result = started(
      durableEvent("session.compaction.failed", {
        sessionID: root,
        reason: "auto",
        error: { type: "compaction.unavailable", message: "Nothing to compact yet" },
      }),
      durableEvent("session.compaction.started", { sessionID: root, reason: "auto", recent: "" }),
      durableEvent("session.compaction.ended", { sessionID: root, reason: "auto", text: "summary", recent: "" }),
      durableEvent("session.compaction.ended", { sessionID: root, reason: "auto", text: "summary", recent: "" }),
    )

    expect(updates(result.outputs).map((update) => update._meta?.["opencode/compaction"])).toEqual([
      {
        status: "failed",
        messageId: "msg_2",
        reason: "auto",
        error: { type: "compaction.unavailable", message: "Nothing to compact yet" },
      },
      { status: "started", messageId: "msg_3", reason: "auto" },
      { status: "completed", messageId: "msg_3", reason: "auto" },
    ])
    expect(result.state.compactions.size).toBe(0)
  })

  test("maps root terminals to responses and failures", () => {
    const ok = started(stepEnded(root, "msg", { finish: "content-filter" }), succeeded(root))
    const stopped = started(interrupted(root))
    const auth = started(failed(root, { type: "provider.auth", message: "missing key" }))
    const broken = started(failed(root, { type: "provider.rate-limit", message: "slow down" }))
    const filtered = started(failed(root, { type: "provider.content-filter", message: "blocked" }))

    expect(ok.terminal).toBe("succeeded")
    expect(ACPTranslate.response(ok.state, root, "succeeded", false).stopReason).toBe("refusal")
    expect(stopped.terminal).toBe("interrupted")
    expect(ACPTranslate.response(stopped.state, root, "interrupted", false).stopReason).toBe("cancelled")
    expect(ACPTranslate.failure(auth.state)?._tag).toBe("ACPAuthRequiredError")
    expect(ACPTranslate.failure(broken.state)).toMatchObject({
      _tag: "ACPServiceFailureError",
      safeMessage: "slow down",
      errorName: "provider.rate-limit",
    })
    expect(ACPTranslate.failure(filtered.state)).toBeUndefined()
    expect(ACPTranslate.response(filtered.state, root, "failed", false).stopReason).toBe("refusal")
    expect(ACPTranslate.response(ACPTranslate.initial, root, "succeeded", true)).toEqual({
      stopReason: "cancelled",
      _meta: {},
    })
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
    expect([...turn.state.openChildren]).toEqual(["ses_a", "ses_b"])
    expect(first.outputs).toEqual([])
    expect(first.terminal).toBeUndefined()
    expect(last.state.children.has("ses_later")).toBe(false)
    expect(last.terminal).toBe("interrupted")
  })
})

describe("acp replay translation", () => {
  test("numbers reasoning parts separately from the mixed content", () => {
    const message = assistantMessage("msg_1", {
      content: [
        { type: "reasoning", text: "a" },
        { type: "text", text: "b" },
        { type: "reasoning", text: "c" },
      ],
    })

    expect(
      [...ACPTranslate.replayMessage(message, "/workspace")].map((update) => [
        update.sessionUpdate,
        "messageId" in update && update.messageId,
      ]),
    ).toEqual([
      ["agent_thought_chunk", "msg_1:reasoning:0"],
      ["agent_message_chunk", "msg_1"],
      ["agent_thought_chunk", "msg_1:reasoning:1"],
    ])
  })
})

function stepStarted(sessionID: string) {
  return durableEvent("session.step.started", {
    sessionID,
    assistantMessageID: "msg_step",
    agent: "build",
    model: { providerID: "test", id: "test-model" },
    started: 0,
  })
}
