import { describe, expect, test } from "bun:test"
import type { SessionNotification } from "@agentclientprotocol/sdk"
import { resolve } from "node:path"
import { ACPElicitation } from "../../src/acp/elicitation"
import {
  assistantMessage,
  childCreated,
  delivered,
  durableEvent,
  ephemeralEvent,
  failed,
  interrupted,
  permissionAsked,
  reasoningDelta,
  startSession,
  stepEnded,
  succeeded,
  textDelta,
  toolCalled,
  toolFailed,
  toolProgress,
  toolStarted,
  toolSucceeded,
  turn,
  type ChildUpdate,
} from "./wire-fixture"

describe("acp turn events over the wire", () => {
  test("isolates events from other sessions and other inputs", async () => {
    await using acp = await startSession({
      onPrompt: ({ sessionID, id }) => [
        textDelta(sessionID, "msg_before", "before admission"),
        delivered("ses_other", id),
        delivered(sessionID, "input_other"),
        textDelta(sessionID, "msg_wrong_input", "wrong input"),
        delivered(sessionID, id),
        textDelta("ses_other", "msg_other", "other session"),
        textDelta(sessionID, "msg_accepted", "accepted"),
        stepEnded(sessionID, "msg_accepted"),
        succeeded("ses_other"),
        succeeded(sessionID),
      ],
    })

    const response = await acp.prompt(acp.sessionId, "hello")

    expect(turnUpdates(acp.updates)).toEqual([
      {
        sessionId: acp.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "msg_accepted",
          content: { type: "text", text: "accepted" },
        },
      },
    ])
    expect(response.stopReason).toBe("end_turn")
  })

  test("streams ordered reasoning and text chunks before admission returns", async () => {
    const releaseAdmission = Promise.withResolvers<void>()
    await using acp = await startSession({ onPrompt: () => releaseAdmission.promise })

    const prompt = acp.prompt(acp.sessionId, "hello")
    const settled = { value: false }
    void prompt.finally(() => {
      settled.value = true
    })
    const submitted = await acp.until(() => acp.server.prompts[0], "prompt submission")
    const sessionID = acp.sessionId
    acp.server.send(
      ...turn(
        sessionID,
        submitted.id,
        reasoningDelta(sessionID, "msg_order", "think-1"),
        reasoningDelta(sessionID, "msg_order", " continued"),
        textDelta(sessionID, "msg_order", "answer", 1),
        reasoningDelta(sessionID, "msg_order", "think-2", 1),
        stepEnded(sessionID, "msg_order"),
      ),
    )
    await acp.until(() => chunks(acp.updates).length === 4, "streamed chunks")
    expect(settled.value).toBe(false)

    releaseAdmission.resolve()
    expect((await prompt).stopReason).toBe("end_turn")
    expect(chunks(acp.updates)).toEqual([
      ["agent_thought_chunk", "msg_order:reasoning:0", "think-1"],
      ["agent_thought_chunk", "msg_order:reasoning:0", " continued"],
      ["agent_message_chunk", "msg_order", "answer"],
      ["agent_thought_chunk", "msg_order:reasoning:1", "think-2"],
    ])
  })

  test("replays reasoning parts with the same message IDs as live reasoning ordinals", async () => {
    await using acp = await startSession()
    acp.server.messages.set(acp.sessionId, [
      assistantMessage("msg_order", {
        time: { created: 1 },
        content: [
          { type: "reasoning", text: "think-1 continued" },
          { type: "text", text: "answer" },
          { type: "reasoning", text: "think-2" },
        ],
      }),
    ])

    await acp.request("session/load", { cwd: "/workspace", sessionId: acp.sessionId, mcpServers: [] })

    expect(chunks(acp.updates)).toEqual([
      ["agent_thought_chunk", "msg_order:reasoning:0", "think-1 continued"],
      ["agent_message_chunk", "msg_order", "answer"],
      ["agent_thought_chunk", "msg_order:reasoning:1", "think-2"],
    ])
  })

  test("projects foreground child session updates onto the parent turn without the child capability", async () => {
    await using acp = await startSession({
      onPrompt: ({ sessionID, id }) =>
        turn(
          sessionID,
          id,
          childCreated("ses_child", sessionID, "Explore code"),
          durableEvent("session.execution.started", { sessionID: "ses_child" }),
          toolStarted("ses_child", "call_read", "read"),
          toolCalled("ses_child", "call_read", { path: "/workspace/src/index.ts" }),
          toolSucceeded("ses_child", "call_read", {}, "source"),
          succeeded("ses_child"),
        ),
    })

    const response = await acp.prompt(acp.sessionId, "hello")

    const updates = turnUpdates(acp.updates)
    expect(updates.map((item) => [item.sessionId, item.update.sessionUpdate, toolCallID(item)])).toEqual([
      [acp.sessionId, "tool_call", "ses_child:call_read"],
      [acp.sessionId, "tool_call_update", "ses_child:call_read"],
      [acp.sessionId, "tool_call_update", "ses_child:call_read"],
    ])
    expect(updates[0]?.update).toMatchObject({
      title: "Explore code: read",
      _meta: {
        "opencode/child-session": { id: "ses_child", parentID: acp.sessionId, depth: 1, title: "Explore code" },
      },
    })
    expect(acp.childUpdates).toEqual([])
    expect(response.stopReason).toBe("end_turn")
  })

  test("routes foreground and nested child updates to the extension when the client supports it", async () => {
    await using acp = await startSession({
      capabilities: { childSessionUpdates: true },
      onPrompt: ({ sessionID, id }) =>
        turn(
          sessionID,
          id,
          childCreated("ses_child", sessionID, "Explore"),
          childCreated("ses_grandchild", "ses_child", "Deeper"),
          durableEvent("session.execution.started", { sessionID: "ses_grandchild" }),
          textDelta("ses_grandchild", "msg_grandchild", "nested"),
          failed("ses_grandchild", { type: "tool.error", message: "boom" }),
          succeeded("ses_child"),
        ),
    })

    const response = await acp.prompt(acp.sessionId, "hello")

    expect(turnUpdates(acp.updates)).toEqual([])
    expect(acp.childUpdates).toEqual([
      expect.objectContaining({ childSessionId: "ses_child", depth: 1, type: "status", status: "created" }),
      expect.objectContaining({
        childSessionId: "ses_grandchild",
        parentSessionId: "ses_child",
        rootSessionId: acp.sessionId,
        depth: 2,
        title: "Deeper",
        type: "status",
        status: "created",
      }),
      expect.objectContaining({ childSessionId: "ses_grandchild", type: "status", status: "running" }),
      expect.objectContaining({
        childSessionId: "ses_grandchild",
        type: "update",
        update: expect.objectContaining({ sessionUpdate: "agent_message_chunk", messageId: "msg_grandchild" }),
      }),
      expect.objectContaining({
        childSessionId: "ses_grandchild",
        type: "status",
        status: "failed",
        error: { type: "tool.error", message: "boom" },
      }),
      expect.objectContaining({ childSessionId: "ses_child", type: "status", status: "completed" }),
    ])
    expect(response.stopReason).toBe("end_turn")
  })

  test("continues child extension updates after the parent turn ends", async () => {
    await using acp = await startSession({
      capabilities: { childSessionUpdates: true },
      onPrompt: ({ sessionID, id }) =>
        turn(sessionID, id, childCreated("ses_background", sessionID, "Background research")),
    })

    expect((await acp.prompt(acp.sessionId, "hello")).stopReason).toBe("end_turn")

    acp.server.send(
      childCreated("ses_future", acp.sessionId, "Later turn child"),
      durableEvent("session.execution.started", { sessionID: "ses_future" }),
      durableEvent("session.execution.started", { sessionID: "ses_background" }),
      toolStarted("ses_background", "call_shell", "shell"),
      toolCalled("ses_background", "call_shell", { command: "pwd" }),
      toolSucceeded("ses_background", "call_shell", { exit: 0 }, "/workspace"),
      succeeded("ses_background"),
    )
    await acp.until(
      () => acp.childUpdates.some((item) => item.type === "status" && item.status === "completed"),
      "background child completion",
    )

    expect(turnUpdates(acp.updates)).toEqual([])
    expect(acp.childUpdates.map(childUpdateKind)).toEqual([
      "status:created",
      "status:running",
      "update:tool_call",
      "update:tool_call_update",
      "update:tool_call_update",
      "status:completed",
    ])
    expect(acp.childUpdates[2]).toMatchObject({
      rootSessionId: acp.sessionId,
      childSessionId: "ses_background",
      parentSessionId: acp.sessionId,
      depth: 1,
      title: "Background research",
      type: "update",
      update: { toolCallId: "ses_background:call_shell" },
    })
    expect(acp.childUpdates.some((item) => item.childSessionId === "ses_future")).toBe(false)
  })

  test("keeps following open children after a cancelled turn", async () => {
    await using acp = await startSession({
      capabilities: { childSessionUpdates: true },
      onPrompt: ({ sessionID, id }) => [
        delivered(sessionID, id),
        childCreated("ses_background", sessionID, "Background research"),
        textDelta(sessionID, "msg_root", "working"),
      ],
      onInterrupt: ({ sessionID }) => [interrupted(sessionID)],
      permission: () => ({ outcome: { outcome: "selected", optionId: "once" } }),
    })

    const prompt = acp.prompt(acp.sessionId, "hello")
    await acp.waitForUpdate((item) => item.update.sessionUpdate === "agent_message_chunk")
    await acp.notify("session/cancel", { sessionId: acp.sessionId })
    expect((await prompt).stopReason).toBe("cancelled")
    acp.server.send(permissionAsked("ses_background", "perm_background"), interrupted("ses_background"))

    await acp.until(
      () => acp.childUpdates.some((item) => item.type === "status" && item.status === "interrupted"),
      "background child interruption",
    )
    await acp.until(() => acp.server.replies.length === 1, "background permission reply")
    expect(acp.childUpdates.map(childUpdateKind)).toEqual(["status:created", "status:interrupted"])
    expect(acp.server.replies).toEqual([
      { sessionID: "ses_background", requestID: "perm_background", decision: "once" },
    ])
  })

  test("stops following background children once the session closes", async () => {
    await using acp = await startSession({
      capabilities: { childSessionUpdates: true },
      onPrompt: ({ sessionID, id, text }) =>
        text === "hello"
          ? turn(sessionID, id, childCreated("ses_background", sessionID, "Background research"))
          : turn(sessionID, id),
    })
    const other = await acp.newSession()

    expect((await acp.prompt(acp.sessionId, "hello")).stopReason).toBe("end_turn")
    await acp.request("session/close", { sessionId: acp.sessionId })
    acp.server.send(textDelta("ses_background", "msg_late", "after close"))

    expect((await acp.prompt(other.sessionId, "later")).stopReason).toBe("end_turn")
    expect(acp.childUpdates.map(childUpdateKind)).toEqual(["status:created"])
  })

  test("streams tool pending, progress, success, and failure updates", async () => {
    await using acp = await startSession({
      onPrompt: ({ sessionID, id }) =>
        turn(
          sessionID,
          id,
          toolStarted(sessionID, "call_ok", "shell"),
          toolCalled(sessionID, "call_ok", { command: "printf done", workdir: "sub" }),
          toolProgress(sessionID, "call_ok", { phase: 1 }),
          toolSucceeded(sessionID, "call_ok", { exit: 0 }, "done"),
          toolStarted(sessionID, "call_fail", "read"),
          toolCalled(sessionID, "call_fail", { path: "/workspace/missing.ts" }),
          toolProgress(sessionID, "call_fail", { bytes: 0 }),
          toolFailed(sessionID, "call_fail", {
            error: { type: "tool.error", message: "not found" },
            metadata: { bytes: 0 },
            content: [{ type: "text", text: "opening" }],
          }),
          stepEnded(sessionID, "msg_tools"),
        ),
    })

    const response = await acp.prompt(acp.sessionId, "hello")

    const updates = turnUpdates(acp.updates)
    expect(updates.map((item) => [item.update.sessionUpdate, toolStatus(item), toolCallID(item)])).toEqual([
      ["tool_call", "pending", "call_ok"],
      ["tool_call_update", "in_progress", "call_ok"],
      ["tool_call_update", "in_progress", "call_ok"],
      ["tool_call_update", "completed", "call_ok"],
      ["tool_call", "pending", "call_fail"],
      ["tool_call_update", "in_progress", "call_fail"],
      ["tool_call_update", "in_progress", "call_fail"],
      ["tool_call_update", "failed", "call_fail"],
    ])
    expect(updates[1]?.update).toMatchObject({
      title: "printf done",
      kind: "execute",
      locations: [{ path: resolve("/workspace", "sub") }],
      rawInput: { command: "printf done", workdir: "sub" },
    })
    expect(updates[2]?.update).not.toHaveProperty("content")
    expect(updates[3]?.update).toMatchObject({
      content: [{ type: "content", content: { type: "text", text: "done" } }],
      rawOutput: { metadata: { exit: 0 } },
    })
    expect(updates[7]?.update).toMatchObject({
      kind: "read",
      locations: [{ path: "/workspace/missing.ts" }],
      content: [
        { type: "content", content: { type: "text", text: "opening" } },
        { type: "content", content: { type: "text", text: "not found" } },
      ],
      rawOutput: { metadata: { bytes: 0 }, error: "not found" },
    })
    expect(response.stopReason).toBe("end_turn")
  })

  test("cancels unsupported session forms so execution can continue", async () => {
    await using acp = await startSession({
      onPrompt: ({ sessionID, id }) => [
        delivered(sessionID, id),
        ephemeralEvent("form.created", {
          form: {
            id: "frm_question",
            sessionID,
            title: "Questions",
            metadata: { kind: "question" },
            fields: [{ key: "q0", title: "Choice", type: "string" }],
          },
        }),
      ],
      onFormCancel: ({ sessionID, formID }) => [
        ephemeralEvent("form.cancelled", { sessionID, id: formID }),
        succeeded(sessionID),
      ],
    })

    expect((await acp.prompt(acp.sessionId, "hello")).stopReason).toBe("end_turn")
    expect(acp.server.cancelledForms).toEqual([
      { sessionID: acp.sessionId, formID: "frm_question", message: ACPElicitation.UnshownQuestionMessage },
    ])
    expect(acp.elicitations).toEqual([])
  })

  test("reports locations for native edit, write, and patch tools (https://github.com/anomalyco/opencode/issues/49591)", async () => {
    const patchText = [
      "*** Begin Patch",
      "*** Update File: /workspace/src/c.ts",
      "@@",
      "-one",
      "+two",
      "*** End Patch",
    ].join("\n")
    await using acp = await startSession({
      onPrompt: ({ sessionID, id }) =>
        turn(
          sessionID,
          id,
          toolStarted(sessionID, "call_edit", "edit"),
          toolCalled(sessionID, "call_edit", { path: "/workspace/src/a.ts", oldString: "a", newString: "b" }),
          toolSucceeded(sessionID, "call_edit", {}, "edited"),
          toolStarted(sessionID, "call_write", "write"),
          toolCalled(sessionID, "call_write", { path: "/workspace/src/b.ts", content: "b" }),
          toolSucceeded(sessionID, "call_write", {}, "written"),
          toolStarted(sessionID, "call_patch", "patch"),
          toolCalled(sessionID, "call_patch", { patchText }),
          toolSucceeded(sessionID, "call_patch", {}, "patched"),
        ),
    })

    await acp.prompt(acp.sessionId, "hello")

    const locations = turnUpdates(acp.updates)
      .filter((item) => item.update.sessionUpdate === "tool_call_update")
      .map((item) => [
        toolCallID(item),
        toolStatus(item),
        "locations" in item.update ? item.update.locations : undefined,
      ])
    expect(locations).toEqual([
      ["call_edit", "in_progress", [{ path: "/workspace/src/a.ts" }]],
      ["call_edit", "completed", [{ path: "/workspace/src/a.ts" }]],
      ["call_write", "in_progress", [{ path: "/workspace/src/b.ts" }]],
      ["call_write", "completed", [{ path: "/workspace/src/b.ts" }]],
      ["call_patch", "in_progress", [{ path: "/workspace/src/c.ts" }]],
      ["call_patch", "completed", [{ path: "/workspace/src/c.ts" }]],
    ])
  })
})

function turnUpdates(updates: readonly SessionNotification[]) {
  return updates.filter(
    (item) => item.update.sessionUpdate !== "available_commands_update" && item.update.sessionUpdate !== "usage_update",
  )
}

function chunks(updates: readonly SessionNotification[]) {
  return updates.flatMap((item) =>
    item.update.sessionUpdate === "agent_message_chunk" || item.update.sessionUpdate === "agent_thought_chunk"
      ? [
          [
            item.update.sessionUpdate,
            item.update.messageId,
            item.update.content.type === "text" ? item.update.content.text : undefined,
          ],
        ]
      : [],
  )
}

function childUpdateKind(item: ChildUpdate) {
  return item.type === "status" ? `status:${item.status}` : `update:${item.update.sessionUpdate}`
}

function toolCallID(item: SessionNotification) {
  return "toolCallId" in item.update ? item.update.toolCallId : undefined
}

function toolStatus(item: SessionNotification) {
  return "status" in item.update ? item.update.status : undefined
}
