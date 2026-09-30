import { describe, expect, test } from "bun:test"
import type { SessionNotification } from "@agentclientprotocol/sdk"
import { resolve } from "node:path"
import {
  ChildSessionUpdateMethod,
  childCreated,
  delivered,
  durableEvent,
  ephemeralEvent,
  startWire,
  stepEnded,
  succeeded,
  textDelta,
  toolCalled,
  toolProgress,
  toolStarted,
  toolSucceeded,
} from "./wire-fixture"

describe("acp turn events over the wire", () => {
  test("subscribes before admission and isolates sessions and input IDs", async () => {
    await using acp = await startWire({
      onPrompt({ sessionID, id, send }) {
        send(textDelta(sessionID, "msg_before", "before admission"))
        send(delivered("ses_other", id))
        send(delivered(sessionID, "input_other"))
        send(textDelta(sessionID, "msg_wrong_input", "wrong input"))
        send(delivered(sessionID, id))
        send(textDelta("ses_other", "msg_other", "other session"))
        send(textDelta(sessionID, "msg_accepted", "accepted"))
        send(stepEnded(sessionID, "msg_accepted"))
        send(succeeded("ses_other"))
        send(succeeded(sessionID))
      },
    })
    await acp.initialize()
    const session = await acp.newSession()

    const response = await acp.prompt(session.sessionId, "hello")

    const paths = acp.server.requests.map((request) => request.path)
    expect(paths.indexOf("/api/event")).toBeLessThan(paths.indexOf(`/api/session/${session.sessionId}/prompt`))
    expect(turnUpdates(acp.updates)).toEqual([
      {
        sessionId: session.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "msg_accepted",
          content: { type: "text", text: "accepted" },
        },
      },
    ])
    expect(response.stopReason).toBe("end_turn")
  })

  test("streams ordered reasoning and text before admission returns and replays them with the same IDs", async () => {
    const releaseSubmit = Promise.withResolvers<void>()
    await using acp = await startWire({
      async onPrompt({ sessionID, id, send }) {
        send(delivered(sessionID, id))
        send(
          ephemeralEvent("session.reasoning.delta", {
            sessionID,
            assistantMessageID: "msg_order",
            ordinal: 0,
            delta: "think-1",
          }),
        )
        send(
          ephemeralEvent("session.reasoning.delta", {
            sessionID,
            assistantMessageID: "msg_order",
            ordinal: 0,
            delta: " continued",
          }),
        )
        send(textDelta(sessionID, "msg_order", "answer", 1))
        send(
          ephemeralEvent("session.reasoning.delta", {
            sessionID,
            assistantMessageID: "msg_order",
            ordinal: 1,
            delta: "think-2",
          }),
        )
        send(stepEnded(sessionID, "msg_order"))
        send(succeeded(sessionID))
        await releaseSubmit.promise
      },
    })
    await acp.initialize()
    const session = await acp.newSession()

    const prompt = acp.prompt(session.sessionId, "hello")
    const settled = { value: false }
    void prompt.finally(() => {
      settled.value = true
    })
    await acp.until(() => chunks(acp.updates).length === 4, "streamed chunks")
    expect(settled.value).toBe(false)
    expect(acp.server.requests.some((request) => request.path.includes("/message/"))).toBe(false)

    releaseSubmit.resolve()
    const response = await prompt
    const live = chunks(acp.updates)
    expect(live).toEqual([
      ["agent_thought_chunk", "msg_order:reasoning:0", "think-1"],
      ["agent_thought_chunk", "msg_order:reasoning:0", " continued"],
      ["agent_message_chunk", "msg_order", "answer"],
      ["agent_thought_chunk", "msg_order:reasoning:1", "think-2"],
    ])
    expect(acp.server.requests.map((request) => request.path)).toContain(
      `/api/session/${session.sessionId}/message/msg_order`,
    )
    expect(response).toMatchObject({ stopReason: "end_turn", usage: { totalTokens: 2 } })

    acp.server.messages.set(session.sessionId, [
      {
        id: "msg_order",
        type: "assistant",
        agent: "build",
        model: { providerID: "test", id: "test-model" },
        time: { created: 1 },
        content: [
          { type: "reasoning", text: "think-1 continued" },
          { type: "text", text: "answer" },
          { type: "reasoning", text: "think-2" },
        ],
      },
    ])
    const before = acp.updates.length
    await acp.request("session/load", { cwd: "/workspace", sessionId: session.sessionId, mcpServers: [] })
    expect(chunks(acp.updates.slice(before))).toEqual([
      ["agent_thought_chunk", "msg_order:reasoning:0", "think-1 continued"],
      live[2],
      live[3],
    ])
  })

  test("projects foreground child session updates onto the parent turn without the child capability", async () => {
    await using acp = await startWire({
      onPrompt({ sessionID, id, send }) {
        send(delivered(sessionID, id))
        send(childCreated("ses_child", sessionID, "Explore code"))
        send(durableEvent("session.execution.started", { sessionID: "ses_child" }))
        send(toolStarted("ses_child", "call_read", "read"))
        send(toolCalled("ses_child", "call_read", { path: "/workspace/src/index.ts" }))
        send(toolSucceeded("ses_child", "call_read", {}, "source"))
        send(succeeded("ses_child"))
        send(succeeded(sessionID))
      },
    })
    await acp.initialize()
    const session = await acp.newSession()

    const response = await acp.prompt(session.sessionId, "hello")

    const updates = turnUpdates(acp.updates)
    expect(updates.map((item) => [item.sessionId, item.update.sessionUpdate, toolCallID(item)])).toEqual([
      [session.sessionId, "tool_call", "ses_child:call_read"],
      [session.sessionId, "tool_call_update", "ses_child:call_read"],
      [session.sessionId, "tool_call_update", "ses_child:call_read"],
    ])
    expect(updates[0]?.update).toMatchObject({
      title: "Explore code: read",
      _meta: {
        "opencode/child-session": { id: "ses_child", parentID: session.sessionId, depth: 1, title: "Explore code" },
      },
    })
    expect(acp.extensions).toEqual([])
    expect(response.stopReason).toBe("end_turn")
  })

  test("routes foreground and nested child updates to the extension when the client supports it", async () => {
    await using acp = await startWire({
      onPrompt({ sessionID, id, send }) {
        send(delivered(sessionID, id))
        send(childCreated("ses_child", sessionID, "Explore"))
        send(childCreated("ses_grandchild", "ses_child", "Deeper"))
        send(durableEvent("session.execution.started", { sessionID: "ses_grandchild" }))
        send(textDelta("ses_grandchild", "msg_grandchild", "nested"))
        send(
          durableEvent("session.execution.failed", {
            sessionID: "ses_grandchild",
            error: { type: "tool.error", message: "boom" },
          }),
        )
        send(succeeded("ses_child"))
        send(succeeded(sessionID))
      },
    })
    await acp.initialize({ childSessionUpdates: true })
    const session = await acp.newSession()

    const response = await acp.prompt(session.sessionId, "hello")

    expect(turnUpdates(acp.updates)).toEqual([])
    expect(acp.extensions.map((item) => item.method)).toEqual(Array(6).fill(ChildSessionUpdateMethod))
    expect(acp.extensions.map((item) => item.params)).toEqual([
      expect.objectContaining({ childSessionId: "ses_child", depth: 1, type: "status", status: "created" }),
      expect.objectContaining({
        childSessionId: "ses_grandchild",
        parentSessionId: "ses_child",
        rootSessionId: session.sessionId,
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
    await using acp = await startWire({
      onPrompt({ sessionID, id, send }) {
        send(delivered(sessionID, id))
        send(childCreated("ses_background", sessionID, "Background research"))
        send(succeeded(sessionID))
      },
    })
    await acp.initialize({ childSessionUpdates: true })
    const session = await acp.newSession()

    const response = await acp.prompt(session.sessionId, "hello")
    expect(response.stopReason).toBe("end_turn")

    acp.server.send(childCreated("ses_future", session.sessionId, "Later turn child"))
    acp.server.send(durableEvent("session.execution.started", { sessionID: "ses_future" }))
    acp.server.send(durableEvent("session.execution.started", { sessionID: "ses_background" }))
    acp.server.send(toolStarted("ses_background", "call_shell", "shell"))
    acp.server.send(toolCalled("ses_background", "call_shell", { command: "pwd" }))
    acp.server.send(toolSucceeded("ses_background", "call_shell", { exit: 0 }, "/workspace"))
    acp.server.send(succeeded("ses_background"))
    await acp.until(
      () => acp.extensions.some((item) => item.params.type === "status" && item.params.status === "completed"),
      "background child completion",
    )

    expect(turnUpdates(acp.updates)).toEqual([])
    expect(
      acp.extensions.map((item) =>
        item.params.type === "status"
          ? [item.params.type, item.params.status]
          : [item.params.type, field(item.params.update, "sessionUpdate")],
      ),
    ).toEqual([
      ["status", "created"],
      ["status", "running"],
      ["update", "tool_call"],
      ["update", "tool_call_update"],
      ["update", "tool_call_update"],
      ["status", "completed"],
    ])
    expect(acp.extensions[2]?.params).toMatchObject({
      rootSessionId: session.sessionId,
      childSessionId: "ses_background",
      parentSessionId: session.sessionId,
      depth: 1,
      title: "Background research",
      type: "update",
      update: { toolCallId: "ses_background:call_shell" },
    })
    expect(acp.extensions.some((item) => item.params.childSessionId === "ses_future")).toBe(false)
  })

  test("streams tool pending, progress, success, and failure updates", async () => {
    await using acp = await startWire({
      onPrompt({ sessionID, id, send }) {
        send(delivered(sessionID, id))
        send(toolStarted(sessionID, "call_ok", "shell"))
        send(toolCalled(sessionID, "call_ok", { command: "printf done", workdir: "sub" }))
        send(toolProgress(sessionID, "call_ok", { phase: 1 }))
        send(toolSucceeded(sessionID, "call_ok", { exit: 0 }, "done"))
        send(toolStarted(sessionID, "call_fail", "read"))
        send(toolCalled(sessionID, "call_fail", { path: "/workspace/missing.ts" }))
        send(toolProgress(sessionID, "call_fail", { bytes: 0 }))
        send(
          durableEvent("session.tool.failed", {
            sessionID,
            assistantMessageID: "msg_tools",
            id: "call_fail",
            error: { type: "tool.error", message: "not found" },
            metadata: { bytes: 0 },
            content: [{ type: "text", text: "opening" }],
            executed: true,
          }),
        )
        send(stepEnded(sessionID, "msg_tools"))
        send(succeeded(sessionID))
      },
    })
    await acp.initialize()
    const session = await acp.newSession()

    const response = await acp.prompt(session.sessionId, "hello")

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
    await using acp = await startWire({
      onPrompt({ sessionID, id, send }) {
        send(delivered(sessionID, id))
        send(
          ephemeralEvent("form.created", {
            form: {
              id: "frm_question",
              sessionID,
              title: "Questions",
              metadata: { kind: "question" },
              fields: [{ key: "q0", title: "Choice", type: "string" }],
            },
          }),
        )
      },
      onFormCancel({ sessionID, formID, send }) {
        send(ephemeralEvent("form.cancelled", { sessionID, id: formID }))
        send(succeeded(sessionID))
      },
    })
    await acp.initialize()
    const session = await acp.newSession()

    const response = await acp.prompt(session.sessionId, "hello")

    expect(response.stopReason).toBe("end_turn")
    expect(acp.server.requests).toContainEqual(
      expect.objectContaining({ method: "DELETE", path: `/api/session/${session.sessionId}/form/frm_question` }),
    )
  })

  test.todo(
    "reports locations for native edit, write, and patch tools (https://github.com/anomalyco/opencode/issues/49591)",
    async () => {
      const patchText = [
        "*** Begin Patch",
        "*** Update File: /workspace/src/c.ts",
        "@@",
        "-one",
        "+two",
        "*** End Patch",
      ].join("\n")
      await using acp = await startWire({
        onPrompt({ sessionID, id, send }) {
          send(delivered(sessionID, id))
          send(toolStarted(sessionID, "call_edit", "edit"))
          send(toolCalled(sessionID, "call_edit", { path: "/workspace/src/a.ts", oldString: "a", newString: "b" }))
          send(toolSucceeded(sessionID, "call_edit", {}, "edited"))
          send(toolStarted(sessionID, "call_write", "write"))
          send(toolCalled(sessionID, "call_write", { path: "/workspace/src/b.ts", content: "b" }))
          send(toolSucceeded(sessionID, "call_write", {}, "written"))
          send(toolStarted(sessionID, "call_patch", "patch"))
          send(toolCalled(sessionID, "call_patch", { patchText }))
          send(toolSucceeded(sessionID, "call_patch", {}, "patched"))
          send(succeeded(sessionID))
        },
      })
      await acp.initialize()
      const session = await acp.newSession()

      await acp.prompt(session.sessionId, "hello")

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
    },
  )
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

function field(value: unknown, key: string) {
  if (!value || typeof value !== "object") return undefined
  return Object.entries(value).find((entry) => entry[0] === key)?.[1]
}

function toolCallID(item: SessionNotification) {
  return "toolCallId" in item.update ? item.update.toolCallId : undefined
}

function toolStatus(item: SessionNotification) {
  return "status" in item.update ? item.update.status : undefined
}
