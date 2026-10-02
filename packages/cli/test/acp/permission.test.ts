import { describe, expect, test } from "bun:test"
import type { AnyRequest, RequestPermissionResponse } from "@agentclientprotocol/sdk"
import { createTwoFilesPatch } from "diff"
import { Cause } from "effect"
import fs from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../fixture/tmpdir"
import {
  childCreated,
  delivered,
  durableEvent,
  interrupted,
  permissionAsked,
  startSession,
  startWire,
  stepEnded,
  succeeded,
  textDelta,
  toolCalled,
  toolStarted,
  toolSucceeded,
  turn,
  type Wire,
} from "./wire-fixture"

const allowOnce = () => ({ outcome: { outcome: "selected", optionId: "once" } }) as const

describe("acp permissions over the wire", () => {
  test("forwards allow-once and allow-always selections to the server", async () => {
    await using acp = await startSession({
      onPrompt: ({ sessionID, id }) =>
        turn(
          sessionID,
          id,
          toolStarted(sessionID, "call_once", "shell"),
          toolCalled(sessionID, "call_once", { command: "printf hello" }),
          toolStarted(sessionID, "call_always", "read"),
          toolCalled(sessionID, "call_always", { path: "/workspace/file.ts" }),
          permissionAsked(sessionID, "perm_once", {
            action: "shell",
            metadata: { command: "printf hello" },
            source: { type: "tool", messageID: "msg_allow", id: "call_once" },
          }),
          permissionAsked(sessionID, "perm_always", {
            action: "read",
            metadata: { path: "/workspace/file.ts" },
            source: { type: "tool", messageID: "msg_allow", id: "call_always" },
          }),
        ),
      permission: (request) => ({
        outcome: { outcome: "selected", optionId: request.toolCall.toolCallId === "call_once" ? "once" : "always" },
      }),
    })

    await acp.prompt(acp.sessionId, "hello")

    expect(acp.permissions[0]).toMatchObject({
      sessionId: acp.sessionId,
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
      sessionId: acp.sessionId,
      toolCall: {
        toolCallId: "call_always",
        status: "pending",
        title: "/workspace/file.ts",
        kind: "read",
        locations: [{ path: "/workspace/file.ts" }],
        rawInput: { path: "/workspace/file.ts" },
      },
    })
    expect(decisions(acp)).toEqual([
      ["perm_once", "once"],
      ["perm_always", "always"],
    ])
  })

  test("preserves external directory permission context", async () => {
    await using acp = await startSession({
      onPrompt: ({ sessionID, id }) =>
        turn(
          sessionID,
          id,
          permissionAsked(sessionID, "perm_external", {
            action: "external_directory",
            metadata: { filepath: "/tmp/outside/a.ts", parentDir: "/tmp/outside" },
          }),
        ),
      permission: allowOnce,
    })

    await acp.prompt(acp.sessionId, "hello")

    expect(acp.permissions[0]?.toolCall).toMatchObject({
      title: "/tmp/outside",
      locations: [{ path: "/tmp/outside/a.ts" }],
    })
    expect(acp.permissions[0]?.toolCall).not.toHaveProperty("rawInput")
  })

  test("locates path resources without glob patterns when the ask has no tool locations", async () => {
    await using acp = await startSession({
      onPrompt: ({ sessionID, id }) =>
        turn(
          sessionID,
          id,
          permissionAsked(sessionID, "perm_external", {
            action: "external_directory",
            resources: ["/tmp/outside/*", "/tmp/other/*", "/tmp/outside/*"],
            metadata: {},
          }),
          permissionAsked(sessionID, "perm_read", {
            action: "read",
            resources: ["src/[slug].ts", "src/{a,b}.ts", "**/*.ts", "src/?.ts"],
          }),
          permissionAsked(sessionID, "perm_search", { action: "websearch", resources: ["acp spec"] }),
        ),
      permission: allowOnce,
    })

    await acp.prompt(acp.sessionId, "hello")

    expect(acp.permissions.map((request) => request.toolCall.locations)).toEqual([
      [{ path: "/tmp/outside" }, { path: "/tmp/other" }],
      [{ path: path.resolve("/workspace", "src/[slug].ts") }, { path: path.resolve("/workspace", "src/{a,b}.ts") }],
      [],
    ])
  })

  test("asks under the permission ID when ACP does not track the asking tool call", async () => {
    await using acp = await startSession({
      onPrompt: ({ sessionID, id }) =>
        turn(
          sessionID,
          id,
          permissionAsked(sessionID, "perm_untracked", {
            source: { type: "tool", messageID: "msg_tools", id: "call_untracked" },
          }),
        ),
      permission: allowOnce,
    })

    await acp.prompt(acp.sessionId, "hello")

    expect(acp.permissions.map((request) => request.toolCall.toolCallId)).toEqual(["perm_untracked"])
    expect(acp.permissions[0]?.toolCall).not.toHaveProperty("rawInput")
  })

  test("asks about a tracked tool call with its own input", async () => {
    await using acp = await startSession({
      onPrompt: ({ sessionID, id }) =>
        turn(
          sessionID,
          id,
          toolStarted(sessionID, "call_read", "read"),
          toolCalled(sessionID, "call_read", { path: "/workspace/file.ts" }),
          permissionAsked(sessionID, "perm_read", {
            action: "read",
            metadata: { files: ["file.ts"] },
            source: { type: "tool", messageID: "msg_read", id: "call_read" },
          }),
        ),
      permission: allowOnce,
    })

    await acp.prompt(acp.sessionId, "hello")

    const running = acp.updates.flatMap((item) =>
      item.update.sessionUpdate === "tool_call_update" && item.update.status === "in_progress"
        ? [item.update.rawInput]
        : [],
    )
    expect(running).toEqual([{ path: "/workspace/file.ts" }])
    expect(acp.permissions[0]?.toolCall).toMatchObject({ toolCallId: "call_read", rawInput: running[0] })
  })

  test("routes foreground child permissions through the parent ACP session", async () => {
    await using acp = await startSession({
      onPrompt: ({ sessionID, id }) =>
        turn(
          sessionID,
          id,
          childCreated("ses_child", sessionID, "Review code"),
          durableEvent("session.execution.started", { sessionID: "ses_child" }),
          toolStarted("ses_child", "call_child", "read"),
          toolCalled("ses_child", "call_child", { path: "/workspace/child.ts" }),
          permissionAsked("ses_child", "perm_child", {
            action: "read",
            source: { type: "tool", messageID: "msg_child", id: "call_child" },
          }),
          succeeded("ses_child"),
        ),
      permission: allowOnce,
    })

    await acp.prompt(acp.sessionId, "hello")

    const childMeta = {
      "opencode/child-session": { id: "ses_child", parentID: acp.sessionId, depth: 1, title: "Review code" },
    }
    expect(acp.permissions).toHaveLength(1)
    expect(acp.permissions[0]).toMatchObject({
      sessionId: acp.sessionId,
      toolCall: { toolCallId: "ses_child:call_child", title: "Review code: /workspace/child.ts", _meta: childMeta },
    })
    expect(
      acp.updates.flatMap((item) => (item.update.sessionUpdate === "tool_call" ? [item.update._meta] : [])),
    ).toEqual([childMeta])
    expect(acp.server.replies).toEqual([{ sessionID: "ses_child", requestID: "perm_child", decision: "once" }])
  })

  test("asks for a background child's permission after the parent turn ends without the child capability", async () => {
    await using acp = await startSession({
      onPrompt: ({ sessionID, id }) => turn(sessionID, id, childCreated("ses_background", sessionID, "Research")),
      permission: allowOnce,
    })

    expect((await acp.prompt(acp.sessionId, "hello")).stopReason).toBe("end_turn")
    acp.server.send(
      durableEvent("session.execution.started", { sessionID: "ses_background" }),
      permissionAsked("ses_background", "perm_background", {
        action: "read",
        metadata: { path: "/workspace/notes.md" },
      }),
    )
    await acp.until(() => acp.server.replies.length === 1, "background permission reply")

    const childMeta = {
      "opencode/child-session": { id: "ses_background", parentID: acp.sessionId, depth: 1, title: "Research" },
    }
    expect(acp.permissions).toMatchObject([
      {
        sessionId: acp.sessionId,
        toolCall: {
          toolCallId: "ses_background:perm_background",
          title: "Research: /workspace/notes.md",
          _meta: childMeta,
        },
      },
    ])
    expect(acp.server.replies).toEqual([
      { sessionID: "ses_background", requestID: "perm_background", decision: "once" },
    ])
  })

  test("rejects explicit rejection, cancellation, and permission UI failure", async () => {
    await using acp = await startSession({
      onPrompt: ({ sessionID, id }) =>
        turn(
          sessionID,
          id,
          permissionAsked(sessionID, "perm_selected_reject"),
          permissionAsked(sessionID, "perm_cancelled"),
          permissionAsked(sessionID, "perm_failed"),
        ),
      permission(request) {
        if (request.toolCall.toolCallId === "perm_selected_reject") {
          return { outcome: { outcome: "selected", optionId: "reject" } }
        }
        if (request.toolCall.toolCallId === "perm_cancelled") return { outcome: { outcome: "cancelled" } }
        throw new Error("client permission UI failed")
      },
    })

    expect(await acp.prompt(acp.sessionId, "hello")).toMatchObject({ stopReason: "end_turn" })
    expect(decisions(acp)).toEqual([
      ["perm_selected_reject", "reject"],
      ["perm_cancelled", "reject"],
      ["perm_failed", "reject"],
    ])
  })

  test("logs a failed server reply and still answers later asks", async () => {
    await using acp = await startSession({
      onPrompt: ({ sessionID, id }) =>
        turn(sessionID, id, permissionAsked(sessionID, "perm_failed"), permissionAsked(sessionID, "perm_next")),
      fetch: (request) =>
        request.path.endsWith("/permission/perm_failed/reply") ? new Response(null, { status: 500 }) : undefined,
      permission: allowOnce,
    })

    expect(await acp.prompt(acp.sessionId, "hello")).toMatchObject({ stopReason: "end_turn" })
    expect(acp.permissions.map((request) => request.toolCall.toolCallId)).toEqual(["perm_failed", "perm_next"])
    expect(decisions(acp)).toEqual([["perm_next", "once"]])
    expect(acp.logs.map((log) => ({ message: log.message, cause: Cause.squash(log.cause) }))).toMatchObject([
      { message: ["ACP permission reply failed"], cause: { _tag: "ClientError" } },
    ])
  })

  test("serializes permission requests and replies within one session", async () => {
    const releaseFirst = Promise.withResolvers<RequestPermissionResponse>()
    await using acp = await startSession({
      onPrompt: ({ sessionID, id }) =>
        turn(sessionID, id, permissionAsked(sessionID, "perm_1"), permissionAsked(sessionID, "perm_2")),
      permission: (request) =>
        request.toolCall.toolCallId === "perm_1"
          ? releaseFirst.promise
          : { outcome: { outcome: "selected", optionId: "always" } },
    })

    const prompt = acp.prompt(acp.sessionId, "hello")
    await acp.until(() => acp.permissions.length === 1, "first permission")
    expect(acp.permissions.map((request) => request.toolCall.toolCallId)).toEqual(["perm_1"])
    expect(acp.server.replies).toEqual([])

    releaseFirst.resolve({ outcome: { outcome: "selected", optionId: "once" } })
    await prompt

    expect(acp.permissions.map((request) => request.toolCall.toolCallId)).toEqual(["perm_1", "perm_2"])
    expect(decisions(acp)).toEqual([
      ["perm_1", "once"],
      ["perm_2", "always"],
    ])
  })

  test("keeps streaming other children while one child's permission is pending", async () => {
    const release = Promise.withResolvers<RequestPermissionResponse>()
    await using acp = await startSession({
      onPrompt: ({ sessionID, id }) =>
        turn(
          sessionID,
          id,
          childCreated("ses_a", sessionID, "A"),
          childCreated("ses_b", sessionID, "B"),
          permissionAsked("ses_a", "perm_a"),
          textDelta("ses_b", "msg_b", "still streaming"),
          succeeded("ses_b"),
          succeeded("ses_a"),
        ),
      permission: () => release.promise,
    })

    const prompt = acp.prompt(acp.sessionId, "hello")
    await acp.waitForUpdate((item) => item.update.sessionUpdate === "agent_message_chunk", "child B's chunk")
    await acp.until(() => acp.permissions.length === 1, "child A's permission")

    expect(acp.permissions.map((request) => request.toolCall.toolCallId)).toEqual(["ses_a:perm_a"])
    expect(acp.server.replies).toEqual([])
    release.resolve({ outcome: { outcome: "selected", optionId: "once" } })
    expect((await prompt).stopReason).toBe("end_turn")
    expect(decisions(acp)).toEqual([["perm_a", "once"]])
  })

  test("does not let one session's blocked permission stall another session", async () => {
    const releaseBlocked = Promise.withResolvers<RequestPermissionResponse>()
    await using acp = await startWire({ onPrompt: () => undefined, permission: () => releaseBlocked.promise })
    await acp.initialize()
    const blockedSession = await acp.newSession()
    const freeSession = await acp.newSession()

    const blocked = acp.prompt(blockedSession.sessionId, "hello")
    const free = acp.prompt(freeSession.sessionId, "hello")
    const [blockedPrompt, freePrompt] = await acp.until(
      () => acp.server.prompts.length === 2 && acp.server.prompts,
      "both prompt submissions",
    )
    acp.server.send(
      delivered(blockedPrompt.sessionID, blockedPrompt.id),
      delivered(freePrompt.sessionID, freePrompt.id),
      permissionAsked(blockedPrompt.sessionID, "perm_blocked"),
      textDelta(freePrompt.sessionID, "msg_free", "session B continued"),
      stepEnded(freePrompt.sessionID, "msg_free"),
      succeeded(freePrompt.sessionID),
      succeeded(blockedPrompt.sessionID),
    )
    await acp.until(() => acp.permissions.length === 1, "blocked permission")

    expect(await free).toMatchObject({ stopReason: "end_turn" })
    expect(acp.updates).toContainEqual({
      sessionId: freePrompt.sessionID,
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "msg_free",
        content: { type: "text", text: "session B continued" },
      },
    })
    expect(acp.server.replies).toEqual([])

    releaseBlocked.resolve({ outcome: { outcome: "selected", optionId: "once" } })
    expect(await blocked).toMatchObject({ stopReason: "end_turn" })
    expect(decisions(acp)).toEqual([["perm_blocked", "once"]])
  })

  test("cancelling the turn cancels its pending permission request and rejects the permission", async () => {
    await using acp = await startSession({
      onPrompt: ({ sessionID, id }) => [delivered(sessionID, id), permissionAsked(sessionID, "perm_cancel")],
      onPermissionReply: ({ sessionID }) => [interrupted(sessionID)],
      permission: (_request, signal) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => resolve({ outcome: { outcome: "cancelled" } }), { once: true })
        }),
    })

    const prompt = acp.prompt(acp.sessionId, "hello")
    await acp.until(() => acp.permissions.length === 1, "permission request")
    await acp.notify("session/cancel", { sessionId: acp.sessionId })

    expect(await prompt).toMatchObject({ stopReason: "cancelled" })
    expect(decisions(acp)).toEqual([["perm_cancel", "reject"]])
    const asked = acp.received.find(
      (message): message is AnyRequest =>
        "method" in message && "id" in message && message.method === "session/request_permission",
    )
    expect(acp.received).toContainEqual({
      jsonrpc: "2.0",
      method: "$/cancel_request",
      params: { requestId: asked?.id },
    })
  })

  test("rejects asks queued behind a cancelled one without sending them to the client", async () => {
    await using acp = await startSession({
      onPrompt: ({ sessionID, id }) => [
        delivered(sessionID, id),
        permissionAsked(sessionID, "perm_pending"),
        permissionAsked(sessionID, "perm_queued"),
      ],
      onInterrupt: ({ sessionID }) => [interrupted(sessionID)],
      permission: (_request, signal) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => resolve({ outcome: { outcome: "cancelled" } }), { once: true })
        }),
    })

    const prompt = acp.prompt(acp.sessionId, "hello")
    await acp.until(() => acp.permissions.length === 1, "permission request")
    await acp.notify("session/cancel", { sessionId: acp.sessionId })

    expect(await prompt).toMatchObject({ stopReason: "cancelled" })
    expect(acp.permissions.map((request) => request.toolCall.toolCallId)).toEqual(["perm_pending"])
    expect(decisions(acp)).toEqual([
      ["perm_pending", "reject"],
      ["perm_queued", "reject"],
    ])
  })
})

describe("acp edit previews over the wire", () => {
  test("previews core's edit diff during approval", async () => {
    await using dir = await tmpdir()
    const file = path.join(dir.path, "file.ts")
    await fs.writeFile(file, "one\r\ntwo\r\n")
    await using acp = await startWire({
      onPrompt: ({ sessionID, id }) =>
        turn(
          sessionID,
          id,
          toolStarted(sessionID, "call_edit", "edit"),
          toolCalled(sessionID, "call_edit", { path: "file.ts", oldString: "one\ntwo", newString: "one\nthree" }),
          permissionAsked(sessionID, "perm_edit", {
            action: "edit",
            resources: ["file.ts"],
            metadata: { files: [fileDiff("file.ts", "one\r\ntwo\r\n", "one\r\nthree\r\n")] },
            source: { type: "tool", messageID: "msg_edit", id: "call_edit" },
          }),
        ),
      permission: allowOnce,
    })
    await acp.initialize()
    const session = await acp.newSession(dir.path)

    await acp.prompt(session.sessionId, "hello")

    expect(acp.permissions[0]?.toolCall).toMatchObject({
      title: "file.ts",
      kind: "edit",
      locations: [{ path: file }],
      content: [{ type: "diff", path: file, oldText: "one\r\ntwo\r\n", newText: "one\r\nthree\r\n" }],
    })
  })

  test("previews each file in a patch", async () => {
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
      onPrompt: ({ sessionID, id }) => [
        delivered(sessionID, id),
        toolStarted(sessionID, "call_patch", "patch"),
        toolCalled(sessionID, "call_patch", { patchText }),
        permissionAsked(sessionID, "perm_patch", {
          action: "edit",
          source: { type: "tool", messageID: "msg_patch", id: "call_patch" },
        }),
      ],
      onPermissionReply: async ({ sessionID }) => {
        await Promise.all([
          fs.writeFile(path.join(dir.path, "first.ts"), "two\n"),
          fs.writeFile(path.join(dir.path, "second.ts"), "beta\n"),
        ])
        return [
          toolSucceeded(sessionID, "call_patch", { files: [{ file: "first.ts" }, { file: "second.ts" }] }, "patched"),
          succeeded(sessionID),
        ]
      },
      permission: allowOnce,
    })
    await acp.initialize()
    const session = await acp.newSession(dir.path)

    await acp.prompt(session.sessionId, "hello")

    expect(acp.permissions[0]?.toolCall).toMatchObject({
      title: "2 files",
      kind: "edit",
      locations: [{ path: path.join(dir.path, "first.ts") }, { path: path.join(dir.path, "second.ts") }],
      content: [
        { type: "diff", path: path.join(dir.path, "first.ts"), oldText: "one\n", newText: "two\n" },
        { type: "diff", path: path.join(dir.path, "second.ts"), oldText: "alpha\n", newText: "beta\n" },
      ],
    })
  })

  test("previews added files as new and deleted files as empty", async () => {
    await using dir = await tmpdir()
    await fs.writeFile(path.join(dir.path, "gone.ts"), "gone\n")
    const patchText = ["*** Begin Patch", "*** Add File: added.ts", "+one", "*** End Patch"].join("\n")
    await using acp = await startWire({
      onPrompt: ({ sessionID, id }) =>
        turn(
          sessionID,
          id,
          toolStarted(sessionID, "call_write", "write"),
          toolCalled(sessionID, "call_write", { path: "written.ts", content: "two\n" }),
          permissionAsked(sessionID, "perm_write", {
            action: "edit",
            metadata: { files: [fileDiff("written.ts", "", "two\n", "added")] },
            source: { type: "tool", messageID: "msg_write", id: "call_write" },
          }),
          toolStarted(sessionID, "call_patch", "patch"),
          toolCalled(sessionID, "call_patch", { patchText }),
          permissionAsked(sessionID, "perm_patch", {
            action: "edit",
            source: { type: "tool", messageID: "msg_patch", id: "call_patch" },
          }),
          permissionAsked(sessionID, "perm_delete", {
            action: "edit",
            metadata: { files: [fileDiff("gone.ts", "gone\n", "", "deleted")] },
          }),
        ),
      permission: allowOnce,
    })
    await acp.initialize()
    const session = await acp.newSession(dir.path)

    await acp.prompt(session.sessionId, "hello")

    expect(acp.permissions.map((request) => request.toolCall.content)).toEqual([
      [{ type: "diff", path: path.join(dir.path, "written.ts"), oldText: null, newText: "two\n" }],
      [{ type: "diff", path: path.join(dir.path, "added.ts"), oldText: null, newText: "one\n" }],
      [{ type: "diff", path: path.join(dir.path, "gone.ts"), oldText: "gone\n", newText: "" }],
    ])
  })

  test("asks without previews when core's diff no longer applies or the file cannot be read", async () => {
    await using dir = await tmpdir()
    await fs.writeFile(path.join(dir.path, "file.ts"), "changed\n")
    await fs.mkdir(path.join(dir.path, "folder"))
    await using acp = await startWire({
      onPrompt: ({ sessionID, id }) =>
        turn(
          sessionID,
          id,
          permissionAsked(sessionID, "perm_stale", {
            action: "edit",
            resources: ["file.ts"],
            metadata: { files: [fileDiff("file.ts", "one\n", "two\n")] },
          }),
          permissionAsked(sessionID, "perm_folder", {
            action: "edit",
            resources: ["folder"],
            metadata: { files: [fileDiff("folder", "one\n", "two\n")] },
          }),
        ),
      permission: allowOnce,
    })
    await acp.initialize()
    const session = await acp.newSession(dir.path)

    await acp.prompt(session.sessionId, "hello")

    expect(acp.permissions.map((request) => request.toolCall)).toMatchObject([
      { kind: "edit", locations: [{ path: path.join(dir.path, "file.ts") }] },
      { kind: "edit", locations: [{ path: path.join(dir.path, "folder") }] },
    ])
    expect(acp.permissions.map((request) => request.toolCall.content)).toEqual([undefined, undefined])
    expect(decisions(acp)).toEqual([
      ["perm_stale", "once"],
      ["perm_folder", "once"],
    ])
  })

  test("asks without previews when a patch does not apply to the current file", async () => {
    await using dir = await tmpdir()
    await fs.writeFile(path.join(dir.path, "first.ts"), "changed\n")
    const patchText = ["*** Begin Patch", "*** Update File: first.ts", "@@", "-one", "+two", "*** End Patch"].join("\n")
    await using acp = await startWire({
      onPrompt: ({ sessionID, id }) => [
        delivered(sessionID, id),
        toolStarted(sessionID, "call_patch", "patch"),
        toolCalled(sessionID, "call_patch", { patchText }),
        permissionAsked(sessionID, "perm_patch", {
          action: "edit",
          source: { type: "tool", messageID: "msg_patch", id: "call_patch" },
        }),
      ],
      onPermissionReply: ({ sessionID }) => [succeeded(sessionID)],
      permission: allowOnce,
    })
    await acp.initialize()
    const session = await acp.newSession(dir.path)

    await acp.prompt(session.sessionId, "hello")

    expect(acp.permissions[0]?.toolCall).toMatchObject({
      kind: "edit",
      locations: [{ path: path.join(dir.path, "first.ts") }],
    })
    expect(acp.permissions[0]?.toolCall.content).toBeUndefined()
    expect(decisions(acp)).toEqual([["perm_patch", "once"]])
  })

  test("reports the same absolute locations for a moved file in the permission and tool updates", async () => {
    await using dir = await tmpdir()
    await fs.writeFile(path.join(dir.path, "old.ts"), "one\n")
    const patchText = [
      "*** Begin Patch",
      "*** Update File: old.ts",
      "*** Move to: new.ts",
      "@@",
      "-one",
      "+two",
      "*** End Patch",
    ].join("\n")
    await using acp = await startWire({
      onPrompt: ({ sessionID, id }) => [
        delivered(sessionID, id),
        toolStarted(sessionID, "call_move", "patch"),
        toolCalled(sessionID, "call_move", { patchText }),
        permissionAsked(sessionID, "perm_move", {
          action: "edit",
          source: { type: "tool", messageID: "msg_move", id: "call_move" },
        }),
      ],
      onPermissionReply: ({ sessionID }) => [
        toolSucceeded(sessionID, "call_move", {}, "patched"),
        succeeded(sessionID),
      ],
      permission: allowOnce,
    })
    await acp.initialize()
    const session = await acp.newSession(dir.path)

    await acp.prompt(session.sessionId, "hello")

    const locations = [{ path: path.join(dir.path, "old.ts") }, { path: path.join(dir.path, "new.ts") }]
    expect(acp.permissions[0]?.toolCall).toMatchObject({
      locations,
      content: [{ type: "diff", path: path.join(dir.path, "new.ts"), oldText: "one\n", newText: "two\n" }],
    })
    expect(
      acp.updates.flatMap((item) =>
        item.update.sessionUpdate === "tool_call_update" && item.update.toolCallId === "call_move"
          ? [[item.update.status, item.update.locations]]
          : [],
      ),
    ).toEqual([
      ["in_progress", locations],
      ["completed", locations],
    ])
  })

  test("does not echo completed edits to a client that advertises writeTextFile", async () => {
    await using dir = await tmpdir()
    const file = path.join(dir.path, "file.ts")
    await fs.writeFile(file, "after")
    await using acp = await startWire({
      onPrompt: ({ sessionID, id }) =>
        turn(
          sessionID,
          id,
          toolStarted(sessionID, "call_edit", "edit"),
          toolCalled(sessionID, "call_edit", { filePath: file, oldString: "before", newString: "after" }),
          toolSucceeded(sessionID, "call_edit", { files: [{ file }] }, "edited"),
        ),
    })
    await acp.initialize({ writeTextFile: true })
    const session = await acp.newSession(dir.path)

    expect(await acp.prompt(session.sessionId, "hello")).toMatchObject({ stopReason: "end_turn" })
    expect(acp.writes).toEqual([])
    expect(
      acp.updates.flatMap((item) =>
        item.update.sessionUpdate === "tool_call_update" && item.update.status === "completed" ? [item.update] : [],
      ),
    ).toMatchObject([
      {
        toolCallId: "call_edit",
        content: [
          { type: "content", content: { type: "text", text: "edited" } },
          { type: "diff", path: file, oldText: "before", newText: "after" },
        ],
      },
    ])
  })
})

function decisions(acp: Wire) {
  return acp.server.replies.map((reply) => [reply.requestID, reply.decision])
}

function fileDiff(file: string, before: string, after: string, status: "added" | "deleted" | "modified" = "modified") {
  return { file, patch: createTwoFilesPatch(file, file, before, after), additions: 1, deletions: 1, status }
}
