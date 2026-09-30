import { describe, expect, test } from "bun:test"
import type { RequestPermissionResponse } from "@agentclientprotocol/sdk"
import fs from "node:fs/promises"
import path from "node:path"
import {
  childCreated,
  delivered,
  durableEvent,
  permissionAsked,
  startWire,
  stepEnded,
  succeeded,
  textDelta,
  toolCalled,
  toolStarted,
  toolSucceeded,
  type ServerRequest,
} from "./wire-fixture"
import { tmpdir } from "../fixture/tmpdir"

describe("acp permissions over the wire", () => {
  test("forwards allow-once and allow-always selections to the server", async () => {
    await using acp = await startWire({
      onPrompt({ sessionID, id, send }) {
        send(delivered(sessionID, id))
        send(
          permissionAsked(sessionID, "perm_once", {
            action: "shell",
            metadata: { command: "printf hello" },
            source: { type: "tool", messageID: "msg_allow", id: "call_once" },
          }),
        )
        send(
          permissionAsked(sessionID, "perm_always", {
            action: "read",
            metadata: { path: "/workspace/file.ts" },
            source: { type: "tool", messageID: "msg_allow", id: "call_always" },
          }),
        )
        send(succeeded(sessionID))
      },
      permission: (request) => ({
        outcome: { outcome: "selected", optionId: request.toolCall.toolCallId === "call_once" ? "once" : "always" },
      }),
    })
    await acp.initialize()
    const session = await acp.newSession()

    await acp.prompt(session.sessionId, "hello")

    expect(acp.permissions[0]).toMatchObject({
      sessionId: session.sessionId,
      toolCall: {
        toolCallId: "call_once",
        status: "pending",
        title: "printf hello",
        kind: "execute",
        locations: [{ path: "/workspace" }],
        rawInput: { command: "printf hello", cwd: "/workspace" },
      },
      options: [
        { optionId: "once", kind: "allow_once", name: "Allow once" },
        { optionId: "always", kind: "allow_always", name: "Always allow" },
        { optionId: "reject", kind: "reject_once", name: "Reject" },
      ],
    })
    expect(acp.permissions[1]).toMatchObject({
      sessionId: session.sessionId,
      toolCall: {
        toolCallId: "call_always",
        status: "pending",
        title: "/workspace/file.ts",
        kind: "read",
        locations: [{ path: "/workspace/file.ts" }],
        rawInput: { path: "/workspace/file.ts" },
      },
    })
    expect(replies(acp.server.requests)).toEqual([
      ["perm_once", "once"],
      ["perm_always", "always"],
    ])
  })

  test("preserves external directory permission context", async () => {
    await using acp = await startWire({
      onPrompt({ sessionID, id, send }) {
        send(delivered(sessionID, id))
        send(
          permissionAsked(sessionID, "perm_external", {
            action: "external_directory",
            metadata: {
              command: "mkdir -p /tmp/outside",
              description: "Create external directory",
              directories: ["/tmp/outside"],
              patterns: ["/tmp/outside/*"],
            },
          }),
        )
        send(succeeded(sessionID))
      },
      permission: () => ({ outcome: { outcome: "selected", optionId: "once" } }),
    })
    await acp.initialize()
    const session = await acp.newSession()

    await acp.prompt(session.sessionId, "hello")

    expect(acp.permissions[0]?.toolCall).toMatchObject({
      title: "Create external directory",
      locations: [{ path: "/tmp/outside" }],
      rawInput: {
        command: "mkdir -p /tmp/outside",
        description: "Create external directory",
        directories: ["/tmp/outside"],
        patterns: ["/tmp/outside/*"],
      },
    })
  })

  test("routes foreground child permissions through the parent ACP session", async () => {
    await using acp = await startWire({
      onPrompt({ sessionID, id, send }) {
        send(delivered(sessionID, id))
        send(childCreated("ses_child", sessionID, "Review code"))
        send(durableEvent("session.execution.started", { sessionID: "ses_child" }))
        send(
          permissionAsked("ses_child", "perm_child", {
            action: "read",
            metadata: { path: "/workspace/child.ts" },
            source: { type: "tool", messageID: "msg_child", id: "call_child" },
          }),
        )
        send(succeeded("ses_child"))
        send(succeeded(sessionID))
      },
      permission: () => ({ outcome: { outcome: "selected", optionId: "once" } }),
    })
    await acp.initialize()
    const session = await acp.newSession()

    await acp.prompt(session.sessionId, "hello")

    expect(acp.permissions).toHaveLength(1)
    expect(acp.permissions[0]).toMatchObject({
      sessionId: session.sessionId,
      toolCall: { toolCallId: "ses_child:call_child", title: "Review code: /workspace/child.ts" },
    })
    expect(acp.server.requests).toContainEqual(
      expect.objectContaining({
        method: "POST",
        path: "/api/session/ses_child/permission/perm_child/reply",
        body: { decision: "once" },
      }),
    )
  })

  test("rejects explicit rejection, cancellation, and permission UI failure", async () => {
    await using acp = await startWire({
      onPrompt({ sessionID, id, send }) {
        send(delivered(sessionID, id))
        send(permissionAsked(sessionID, "perm_selected_reject"))
        send(permissionAsked(sessionID, "perm_cancelled"))
        send(permissionAsked(sessionID, "perm_failed"))
        send(succeeded(sessionID))
      },
      permission(request) {
        if (request.toolCall.toolCallId === "perm_selected_reject") {
          return { outcome: { outcome: "selected", optionId: "reject" } }
        }
        if (request.toolCall.toolCallId === "perm_cancelled") return { outcome: { outcome: "cancelled" } }
        throw new Error("client permission UI failed")
      },
    })
    await acp.initialize()
    const session = await acp.newSession()

    expect(await acp.prompt(session.sessionId, "hello")).toMatchObject({ stopReason: "end_turn" })
    expect(replies(acp.server.requests)).toEqual([
      ["perm_selected_reject", "reject"],
      ["perm_cancelled", "reject"],
      ["perm_failed", "reject"],
    ])
  })

  test("serializes permission requests and replies within one session", async () => {
    const releaseFirst = Promise.withResolvers<RequestPermissionResponse>()
    await using acp = await startWire({
      onPrompt({ sessionID, id, send }) {
        send(delivered(sessionID, id))
        send(permissionAsked(sessionID, "perm_1"))
        send(permissionAsked(sessionID, "perm_2"))
        send(succeeded(sessionID))
      },
      permission: (request) =>
        request.toolCall.toolCallId === "perm_1"
          ? releaseFirst.promise
          : { outcome: { outcome: "selected", optionId: "always" } },
    })
    await acp.initialize()
    const session = await acp.newSession()

    const prompt = acp.prompt(session.sessionId, "hello")
    await acp.until(() => acp.permissions.length === 1, "first permission")
    expect(acp.permissions.map((request) => request.toolCall.toolCallId)).toEqual(["perm_1"])
    expect(replies(acp.server.requests)).toEqual([])

    releaseFirst.resolve({ outcome: { outcome: "selected", optionId: "once" } })
    await prompt

    expect(acp.permissions.map((request) => request.toolCall.toolCallId)).toEqual(["perm_1", "perm_2"])
    expect(replies(acp.server.requests)).toEqual([
      ["perm_1", "once"],
      ["perm_2", "always"],
    ])
  })

  test("does not let one session's blocked permission stall another session", async () => {
    const releaseBlocked = Promise.withResolvers<RequestPermissionResponse>()
    const promptIDs = new Map<string, string>()
    await using acp = await startWire({
      onPrompt({ sessionID, id, send }) {
        promptIDs.set(sessionID, id)
        const blocked = promptIDs.get("ses_1")
        const free = promptIDs.get("ses_2")
        if (!blocked || !free) return
        send(delivered("ses_1", blocked))
        send(delivered("ses_2", free))
        send(permissionAsked("ses_1", "perm_blocked"))
        send(textDelta("ses_2", "msg_free", "session B continued"))
        send(stepEnded("ses_2", "msg_free"))
        send(succeeded("ses_2"))
        send(succeeded("ses_1"))
      },
      permission: () => releaseBlocked.promise,
    })
    await acp.initialize()
    await acp.newSession()
    await acp.newSession()

    const blocked = acp.prompt("ses_1", "hello")
    await acp.until(
      () => acp.server.requests.some((request) => request.path === "/api/session/ses_1/prompt"),
      "blocked prompt",
    )
    const free = acp.prompt("ses_2", "hello")
    await acp.until(() => acp.permissions.length === 1, "blocked permission")

    expect(await free).toMatchObject({ stopReason: "end_turn" })
    expect(acp.updates).toContainEqual({
      sessionId: "ses_2",
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "msg_free",
        content: { type: "text", text: "session B continued" },
      },
    })
    expect(replies(acp.server.requests)).toEqual([])

    releaseBlocked.resolve({ outcome: { outcome: "selected", optionId: "once" } })
    expect(await blocked).toMatchObject({ stopReason: "end_turn" })
    expect(replies(acp.server.requests)).toEqual([["perm_blocked", "once"]])
  })

  test("cancelling the turn cancels its pending permission request and rejects the permission", async () => {
    await using acp = await startWire({
      onPrompt({ sessionID, id, send }) {
        send(delivered(sessionID, id))
        send(permissionAsked(sessionID, "perm_cancel"))
      },
      onPermissionReply({ sessionID, send }) {
        send(durableEvent("session.execution.interrupted", { sessionID, reason: "user" }))
      },
      permission: (_request, signal) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => resolve({ outcome: { outcome: "cancelled" } }), { once: true })
        }),
    })
    await acp.initialize()
    const session = await acp.newSession()

    const prompt = acp.prompt(session.sessionId, "hello")
    await acp.until(() => acp.permissions.length === 1, "permission request")
    await acp.notify("session/cancel", { sessionId: session.sessionId })

    expect(await prompt).toMatchObject({ stopReason: "cancelled" })
    expect(replies(acp.server.requests)).toEqual([["perm_cancel", "reject"]])
    const asked = acp.received.find((message) => "method" in message && message.method === "session/request_permission")
    expect(asked && "id" in asked ? asked.id : undefined).toBeDefined()
    expect(acp.received).toContainEqual({
      jsonrpc: "2.0",
      method: "$/cancel_request",
      params: { requestId: asked && "id" in asked ? asked.id : undefined },
    })
  })
})

describe("acp edit previews and client file sync over the wire", () => {
  test("previews edits during approval and syncs the completed file", async () => {
    await using dir = await tmpdir()
    const file = path.join(dir.path, "file.ts")
    await fs.writeFile(file, "before")
    await using acp = await startWire({
      onPrompt({ sessionID, id, send }) {
        send(delivered(sessionID, id))
        send(toolStarted(sessionID, "call_edit", "edit"))
        send(toolCalled(sessionID, "call_edit", { path: "file.ts", oldString: "before", newString: "after" }))
        send(
          permissionAsked(sessionID, "perm_edit", {
            action: "edit",
            source: { type: "tool", messageID: "msg_edit", id: "call_edit" },
          }),
        )
      },
      async onPermissionReply({ sessionID, send }) {
        await fs.writeFile(file, "after")
        send(toolSucceeded(sessionID, "call_edit", { files: [{ file: "file.ts" }], replacements: 1 }, "edited"))
        send(succeeded(sessionID))
      },
      permission: () => ({ outcome: { outcome: "selected", optionId: "once" } }),
    })
    await acp.initialize({ writeTextFile: true })
    const session = await acp.newSession(dir.path)

    await acp.prompt(session.sessionId, "hello")

    expect(acp.permissions[0]?.toolCall).toMatchObject({
      title: "file.ts",
      kind: "edit",
      locations: [{ path: "file.ts" }],
      content: [{ type: "diff", path: "file.ts", oldText: "before", newText: "after" }],
    })
    expect(acp.writes).toEqual([{ sessionId: session.sessionId, path: file, content: "after" }])
  })

  test("previews and syncs each file in a patch", async () => {
    await using dir = await tmpdir()
    await Promise.all([
      fs.writeFile(path.join(dir.path, "first.ts"), "one\n"),
      fs.writeFile(path.join(dir.path, "second.ts"), "alpha\n"),
    ])
    const patchText = [
      "*** Begin Patch",
      "*** Update File: first.ts",
      "@@",
      "-one",
      "+two",
      "*** Update File: second.ts",
      "@@",
      "-alpha",
      "+beta",
      "*** End Patch",
    ].join("\n")
    await using acp = await startWire({
      onPrompt({ sessionID, id, send }) {
        send(delivered(sessionID, id))
        send(toolStarted(sessionID, "call_patch", "patch"))
        send(toolCalled(sessionID, "call_patch", { patchText }))
        send(
          permissionAsked(sessionID, "perm_patch", {
            action: "edit",
            source: { type: "tool", messageID: "msg_patch", id: "call_patch" },
          }),
        )
      },
      async onPermissionReply({ sessionID, send }) {
        await Promise.all([
          fs.writeFile(path.join(dir.path, "first.ts"), "two\n"),
          fs.writeFile(path.join(dir.path, "second.ts"), "beta\n"),
        ])
        send(
          toolSucceeded(sessionID, "call_patch", { files: [{ file: "first.ts" }, { file: "second.ts" }] }, "patched"),
        )
        send(succeeded(sessionID))
      },
      permission: () => ({ outcome: { outcome: "selected", optionId: "once" } }),
    })
    await acp.initialize({ writeTextFile: true })
    const session = await acp.newSession(dir.path)

    await acp.prompt(session.sessionId, "hello")

    expect(acp.permissions[0]?.toolCall).toMatchObject({
      title: "2 files",
      kind: "edit",
      locations: [{ path: "first.ts" }, { path: "second.ts" }],
      content: [
        { type: "diff", path: "first.ts", oldText: "one\n", newText: "two\n" },
        { type: "diff", path: "second.ts", oldText: "alpha\n", newText: "beta\n" },
      ],
    })
    expect(acp.writes.toSorted((a, b) => a.path.localeCompare(b.path))).toEqual([
      { sessionId: session.sessionId, path: path.join(dir.path, "first.ts"), content: "two\n" },
      { sessionId: session.sessionId, path: path.join(dir.path, "second.ts"), content: "beta\n" },
    ])
  })

  test("does not sync edits when the client did not advertise writeTextFile", async () => {
    await using dir = await tmpdir()
    await fs.writeFile(path.join(dir.path, "file.ts"), "after")
    await using acp = await startWire({
      onPrompt({ sessionID, id, send }) {
        send(delivered(sessionID, id))
        send(toolStarted(sessionID, "call_edit", "edit"))
        send(toolCalled(sessionID, "call_edit", { filePath: path.join(dir.path, "file.ts") }))
        send(toolSucceeded(sessionID, "call_edit", {}, "edited"))
        send(succeeded(sessionID))
      },
    })
    await acp.initialize()
    const session = await acp.newSession(dir.path)

    expect(await acp.prompt(session.sessionId, "hello")).toMatchObject({ stopReason: "end_turn" })
    expect(acp.writes).toEqual([])
    expect(acp.received.some((message) => "method" in message && message.method === "fs/write_text_file")).toBe(false)
  })
})

function replies(requests: readonly ServerRequest[]) {
  return requests.flatMap((request): Array<[string, string]> => {
    const match = /^\/api\/session\/[^/]+\/permission\/([^/]+)\/reply$/.exec(request.path)
    if (!match?.[1] || !request.body || typeof request.body !== "object") return []
    const decision = "decision" in request.body ? request.body.decision : undefined
    return typeof decision === "string" ? [[decodeURIComponent(match[1]), decision]] : []
  })
}
