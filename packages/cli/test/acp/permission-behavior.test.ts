import { describe, expect, test } from "bun:test"
import type { AgentSideConnection, RequestPermissionRequest, RequestPermissionResponse } from "@agentclientprotocol/sdk"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { streamTurn } from "../../src/acp/event"
import { syncEditedFiles } from "../../src/acp/permission"
import { createSseFixture, durableEvent, ephemeralEvent, withTimeout } from "./sse-fixture"

type SessionUpdateParams = Parameters<AgentSideConnection["sessionUpdate"]>[0]
type Connection = Pick<AgentSideConnection, "sessionUpdate" | "requestPermission"> &
  Partial<Pick<AgentSideConnection, "writeTextFile">>
type Fixture = ReturnType<typeof createSseFixture>

describe("acp permission behavior", () => {
  test("does not sync edits when writeTextFile was not advertised", async () => {
    const writes: Parameters<AgentSideConnection["writeTextFile"]>[0][] = []

    await syncEditedFiles({
      connection: {
        writeTextFile: async (input) => {
          writes.push(input)
          return {}
        },
      },
      writeTextFile: false,
      sessionID: "ses_no_write",
      cwd: "/workspace",
      toolName: "edit",
      toolInput: { filePath: "/workspace/file.ts" },
      metadata: {},
    })

    expect(writes).toEqual([])
  })

  test("forwards allow-once and allow-always selections to the generated client", async () => {
    const permissionRequests: RequestPermissionRequest[] = []
    const fixture = createSseFixture({
      onPrompt({ id, send }) {
        send(durableEvent("session.input.promoted", { sessionID: "ses_allow", inputID: id }))
        send(
          permissionAsked("ses_allow", "perm_once", {
            action: "shell",
            metadata: { command: "printf hello" },
            source: { type: "tool", messageID: "msg_allow", id: "call_once" },
          }),
        )
        send(
          permissionAsked("ses_allow", "perm_always", {
            action: "read",
            metadata: { path: "/workspace/file.ts" },
            source: { type: "tool", messageID: "msg_allow", id: "call_always" },
          }),
        )
        send(durableEvent("session.execution.succeeded", { sessionID: "ses_allow" }))
      },
    })
    const connection = {
      sessionUpdate: async () => {},
      requestPermission: async (request) => {
        permissionRequests.push(request)
        return {
          outcome: {
            outcome: "selected",
            optionId: request.toolCall.toolCallId === "call_once" ? "once" : "always",
          },
        }
      },
    } satisfies Connection

    try {
      await startTurn(fixture, connection, "ses_allow", "input_allow")

      expect(permissionRequests[0]).toMatchObject({
        sessionId: "ses_allow",
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
      expect(permissionRequests[1]).toMatchObject({
        sessionId: "ses_allow",
        toolCall: {
          toolCallId: "call_always",
          status: "pending",
          title: "/workspace/file.ts",
          kind: "read",
          locations: [{ path: "/workspace/file.ts" }],
          rawInput: { path: "/workspace/file.ts" },
        },
      })
      expect(permissionReplies(fixture)).toEqual([
        ["perm_once", "once"],
        ["perm_always", "always"],
      ])
    } finally {
      await fixture.stop()
    }
  })

  test("preserves external directory permission context", async () => {
    const permissionRequests: RequestPermissionRequest[] = []
    const fixture = createSseFixture({
      onPrompt({ id, send }) {
        send(durableEvent("session.input.promoted", { sessionID: "ses_external", inputID: id }))
        send(
          permissionAsked("ses_external", "perm_external", {
            action: "external_directory",
            metadata: {
              command: "mkdir -p /tmp/outside",
              description: "Create external directory",
              directories: ["/tmp/outside"],
              patterns: ["/tmp/outside/*"],
            },
          }),
        )
        send(durableEvent("session.execution.succeeded", { sessionID: "ses_external" }))
      },
    })
    const connection = {
      sessionUpdate: async () => {},
      requestPermission: async (request) => {
        permissionRequests.push(request)
        return { outcome: { outcome: "selected", optionId: "once" } } as const
      },
    } satisfies Connection

    try {
      await startTurn(fixture, connection, "ses_external", "input_external")

      expect(permissionRequests[0]?.toolCall).toMatchObject({
        title: "Create external directory",
        locations: [{ path: "/tmp/outside" }],
        rawInput: {
          command: "mkdir -p /tmp/outside",
          description: "Create external directory",
          directories: ["/tmp/outside"],
          patterns: ["/tmp/outside/*"],
        },
      })
    } finally {
      await fixture.stop()
    }
  })

  test("routes foreground child permissions through the parent ACP session", async () => {
    const permissionRequests: RequestPermissionRequest[] = []
    const fixture = createSseFixture({
      onPrompt({ id, send }) {
        send(durableEvent("session.input.promoted", { sessionID: "ses_parent", inputID: id }))
        send(
          durableEvent("session.created", {
            sessionID: "ses_child",
            slug: "ses_child",
            projectID: "project",
            location: { directory: "/workspace" },
            parentID: "ses_parent",
            title: "Review code",
            version: "test",
          }),
        )
        send(durableEvent("session.execution.started", { sessionID: "ses_child" }))
        send(
          permissionAsked("ses_child", "perm_child", {
            action: "read",
            metadata: { path: "/workspace/child.ts" },
            source: { type: "tool", messageID: "msg_child", id: "call_child" },
          }),
        )
        send(durableEvent("session.execution.succeeded", { sessionID: "ses_child" }))
        send(durableEvent("session.execution.succeeded", { sessionID: "ses_parent" }))
      },
    })
    const connection = {
      sessionUpdate: async () => {},
      requestPermission: async (request) => {
        permissionRequests.push(request)
        return { outcome: { outcome: "selected", optionId: "once" } } as const
      },
    } satisfies Connection

    try {
      await startTurn(fixture, connection, "ses_parent", "input_parent")

      expect(permissionRequests).toHaveLength(1)
      expect(permissionRequests[0]).toMatchObject({
        sessionId: "ses_parent",
        toolCall: {
          toolCallId: "ses_child:call_child",
          title: "Review code: /workspace/child.ts",
        },
      })
      expect(fixture.requests).toContainEqual(
        expect.objectContaining({
          method: "POST",
          path: "/api/session/ses_child/permission/perm_child/reply",
        }),
      )
    } finally {
      await fixture.stop()
    }
  })

  test("authorizes edit resources and syncs the completed file", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-acp-permission-"))
    const file = path.join(cwd, "file.ts")
    await fs.writeFile(file, "before")
    const permissionRequests: RequestPermissionRequest[] = []
    const writes: Parameters<AgentSideConnection["writeTextFile"]>[0][] = []
    const fixture = createSseFixture({
      onPrompt({ id, send }) {
        send(durableEvent("session.input.promoted", { sessionID: "ses_edit", inputID: id }))
        send(
          durableEvent("session.tool.input.started", {
            sessionID: "ses_edit",
            assistantMessageID: "msg_edit",
            id: "call_edit",
            name: "edit",
          }),
        )
        send(
          durableEvent("session.tool.called", {
            sessionID: "ses_edit",
            assistantMessageID: "msg_edit",
            id: "call_edit",
            input: { path: "file.ts", oldString: "before", newString: "after" },
            executed: false,
          }),
        )
        send(
          permissionAsked("ses_edit", "perm_edit", {
            action: "edit",
            resources: ["file.ts"],
            source: { type: "tool", messageID: "msg_edit", id: "call_edit" },
          }),
        )
      },
      async onPermissionReply({ send }) {
        await fs.writeFile(file, "after")
        send(
          durableEvent("session.tool.success", {
            sessionID: "ses_edit",
            assistantMessageID: "msg_edit",
            id: "call_edit",
            metadata: { files: [{ file: "file.ts" }], replacements: 1 },
            content: [{ type: "text", text: "edited" }],
            executed: true,
          }),
        )
        send(durableEvent("session.execution.succeeded", { sessionID: "ses_edit" }))
      },
    })
    const connection = {
      sessionUpdate: async () => {},
      requestPermission: async (request) => {
        permissionRequests.push(request)
        return { outcome: { outcome: "selected", optionId: "once" } } as const
      },
      writeTextFile: async (request) => {
        writes.push(request)
        return {}
      },
    } satisfies Connection

    try {
      await startTurn(fixture, connection, "ses_edit", "input_edit", cwd)

      expect(permissionRequests[0]?.toolCall).toMatchObject({
        title: "file.ts",
        kind: "edit",
        locations: [{ path: "file.ts" }],
      })
      expect(permissionRequests[0]?.toolCall.content).toBeUndefined()
      expect(writes).toEqual([{ sessionId: "ses_edit", path: file, content: "after" }])
    } finally {
      await fixture.stop()
      await fs.rm(cwd, { recursive: true, force: true })
    }
  })

  test("authorizes and syncs each file in a patch", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-acp-patch-permission-"))
    await Promise.all([
      fs.writeFile(path.join(cwd, "first.ts"), "one\n"),
      fs.writeFile(path.join(cwd, "second.ts"), "alpha\n"),
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
    const permissionRequests: RequestPermissionRequest[] = []
    const writes: Parameters<AgentSideConnection["writeTextFile"]>[0][] = []
    const fixture = createSseFixture({
      onPrompt({ id, send }) {
        send(durableEvent("session.input.promoted", { sessionID: "ses_patch", inputID: id }))
        send(
          durableEvent("session.tool.input.started", {
            sessionID: "ses_patch",
            assistantMessageID: "msg_patch",
            id: "call_patch",
            name: "patch",
          }),
        )
        send(
          durableEvent("session.tool.called", {
            sessionID: "ses_patch",
            assistantMessageID: "msg_patch",
            id: "call_patch",
            input: { patchText },
            executed: false,
          }),
        )
        send(
          permissionAsked("ses_patch", "perm_patch", {
            action: "edit",
            resources: ["first.ts", "second.ts"],
            source: { type: "tool", messageID: "msg_patch", id: "call_patch" },
          }),
        )
      },
      async onPermissionReply({ send }) {
        await Promise.all([
          fs.writeFile(path.join(cwd, "first.ts"), "two\n"),
          fs.writeFile(path.join(cwd, "second.ts"), "beta\n"),
        ])
        send(
          durableEvent("session.tool.success", {
            sessionID: "ses_patch",
            assistantMessageID: "msg_patch",
            id: "call_patch",
            metadata: { files: [{ file: "first.ts" }, { file: "second.ts" }] },
            content: [{ type: "text", text: "patched" }],
            executed: true,
          }),
        )
        send(durableEvent("session.execution.succeeded", { sessionID: "ses_patch" }))
      },
    })
    const connection = {
      sessionUpdate: async () => {},
      requestPermission: async (request) => {
        permissionRequests.push(request)
        return { outcome: { outcome: "selected", optionId: "once" } } as const
      },
      writeTextFile: async (request) => {
        writes.push(request)
        return {}
      },
    } satisfies Connection

    try {
      await startTurn(fixture, connection, "ses_patch", "input_patch", cwd)

      expect(permissionRequests[0]?.toolCall).toMatchObject({
        title: "2 files",
        kind: "edit",
        locations: [{ path: "first.ts" }, { path: "second.ts" }],
      })
      expect(permissionRequests[0]?.toolCall.content).toBeUndefined()
      expect(writes.toSorted((a, b) => a.path.localeCompare(b.path))).toEqual([
        { sessionId: "ses_patch", path: path.join(cwd, "first.ts"), content: "two\n" },
        { sessionId: "ses_patch", path: path.join(cwd, "second.ts"), content: "beta\n" },
      ])
    } finally {
      await fixture.stop()
      await fs.rm(cwd, { recursive: true, force: true })
    }
  })

  test("rejects explicit rejection, cancellation, and permission UI failure", async () => {
    const fixture = createSseFixture({
      onPrompt({ id, send }) {
        send(durableEvent("session.input.promoted", { sessionID: "ses_reject", inputID: id }))
        send(permissionAsked("ses_reject", "perm_selected_reject"))
        send(permissionAsked("ses_reject", "perm_cancelled"))
        send(permissionAsked("ses_reject", "perm_failed"))
        send(durableEvent("session.execution.succeeded", { sessionID: "ses_reject" }))
      },
    })
    const connection = {
      sessionUpdate: async () => {},
      requestPermission: async (request): Promise<RequestPermissionResponse> => {
        if (request.toolCall.toolCallId === "perm_selected_reject") {
          return { outcome: { outcome: "selected", optionId: "reject" } }
        }
        if (request.toolCall.toolCallId === "perm_cancelled") return { outcome: { outcome: "cancelled" } }
        throw new Error("client permission UI failed")
      },
    } satisfies Connection

    try {
      const response = await startTurn(fixture, connection, "ses_reject", "input_reject")
      expect(response).toMatchObject({ stopReason: "end_turn" })
      expect(permissionReplies(fixture)).toEqual([
        ["perm_selected_reject", "reject"],
        ["perm_cancelled", "reject"],
        ["perm_failed", "reject"],
      ])
    } finally {
      await fixture.stop()
    }
  })

  test("serializes permission requests and replies within one session", async () => {
    const firstRequested = Promise.withResolvers<void>()
    const releaseFirst = Promise.withResolvers<RequestPermissionResponse>()
    const permissionRequests: RequestPermissionRequest[] = []
    const fixture = createSseFixture({
      onPrompt({ id, send }) {
        send(durableEvent("session.input.promoted", { sessionID: "ses_serial", inputID: id }))
        send(permissionAsked("ses_serial", "perm_1"))
        send(permissionAsked("ses_serial", "perm_2"))
        send(durableEvent("session.execution.succeeded", { sessionID: "ses_serial" }))
      },
    })
    const connection = {
      sessionUpdate: async () => {},
      requestPermission: async (request) => {
        permissionRequests.push(request)
        if (request.toolCall.toolCallId === "perm_1") {
          firstRequested.resolve()
          return releaseFirst.promise
        }
        return { outcome: { outcome: "selected", optionId: "always" } } as const
      },
    } satisfies Connection
    const result = startTurn(fixture, connection, "ses_serial", "input_serial")

    try {
      await withTimeout(firstRequested.promise, "first permission was not requested")
      expect(permissionRequests.map((request) => request.toolCall.toolCallId)).toEqual(["perm_1"])
      expect(permissionReplies(fixture)).toEqual([])

      releaseFirst.resolve({ outcome: { outcome: "selected", optionId: "once" } })
      await withTimeout(result, "serialized permission turn did not finish")

      expect(permissionRequests.map((request) => request.toolCall.toolCallId)).toEqual(["perm_1", "perm_2"])
      expect(permissionReplies(fixture)).toEqual([
        ["perm_1", "once"],
        ["perm_2", "always"],
      ])
    } finally {
      releaseFirst.resolve({ outcome: { outcome: "cancelled" } })
      await result.catch(() => undefined)
      await fixture.stop()
    }
  })

  test("does not let one session's blocked permission stall another session", async () => {
    const blockedRequested = Promise.withResolvers<void>()
    const releaseBlocked = Promise.withResolvers<RequestPermissionResponse>()
    const promptIDs = new Map<string, string>()
    const updates: SessionUpdateParams[] = []
    const fixture = createSseFixture({
      onPrompt({ sessionID, id, send }) {
        promptIDs.set(sessionID, id)
        if (promptIDs.size !== 2) return
        const blockedID = promptIDs.get("ses_blocked")
        const freeID = promptIDs.get("ses_free")
        if (!blockedID || !freeID) throw new Error("both permission test prompts must be registered")
        send(durableEvent("session.input.promoted", { sessionID: "ses_blocked", inputID: blockedID }))
        send(durableEvent("session.input.promoted", { sessionID: "ses_free", inputID: freeID }))
        send(permissionAsked("ses_blocked", "perm_blocked"))
        send(
          ephemeralEvent("session.text.delta", {
            sessionID: "ses_free",
            assistantMessageID: "msg_free",
            ordinal: 0,
            delta: "session B continued",
          }),
        )
        send(
          durableEvent("session.step.ended", {
            sessionID: "ses_free",
            assistantMessageID: "msg_free",
            finish: "stop",
            cost: 0,
            tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
          }),
        )
        send(durableEvent("session.execution.succeeded", { sessionID: "ses_free" }))
        send(durableEvent("session.execution.succeeded", { sessionID: "ses_blocked" }))
      },
    })
    const connection = {
      sessionUpdate: async (update) => {
        updates.push(update)
      },
      requestPermission: async () => {
        blockedRequested.resolve()
        return releaseBlocked.promise
      },
    } satisfies Connection
    const blocked = startTurn(fixture, connection, "ses_blocked", "input_blocked")
    const free = startTurn(fixture, connection, "ses_free", "input_free")

    try {
      await withTimeout(blockedRequested.promise, "blocked permission was not requested")
      const response = await withTimeout(free, "free session was stalled by another session's permission")
      expect(response).toMatchObject({ stopReason: "end_turn" })
      expect(updates).toContainEqual({
        sessionId: "ses_free",
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "msg_free",
          content: { type: "text", text: "session B continued" },
        },
      })
      expect(permissionReplies(fixture)).toEqual([])

      releaseBlocked.resolve({ outcome: { outcome: "selected", optionId: "once" } })
      await withTimeout(blocked, "blocked session did not resume after permission selection")
      expect(permissionReplies(fixture)).toEqual([["perm_blocked", "once"]])
    } finally {
      releaseBlocked.resolve({ outcome: { outcome: "cancelled" } })
      await Promise.all([blocked.catch(() => undefined), free.catch(() => undefined)])
      await fixture.stop()
    }
  })
})

function startTurn(fixture: Fixture, connection: Connection, sessionID: string, inputID: string, cwd = "/workspace") {
  return streamTurn({
    client: fixture.client,
    connection,
    sessionID,
    cwd,
    start: { type: "input", id: inputID },
    writeTextFile: true,
    control: { cancelled: false, admission: new AbortController() },
    submit: (signal) => fixture.client.session.prompt({ sessionID, id: inputID, text: "hello" }, { signal }),
  })
}

function permissionAsked(
  sessionID: string,
  id: string,
  input: {
    readonly action?: string
    readonly resources?: ReadonlyArray<string>
    readonly metadata?: Record<string, unknown>
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly id: string }
  } = {},
) {
  return ephemeralEvent("permission.asked", {
    id,
    sessionID,
    action: input.action ?? "shell",
    resources: [...(input.resources ?? ["*"])],
    metadata: input.metadata ?? { command: "printf hello" },
    ...(input.source ? { source: input.source } : {}),
  })
}

function permissionReplies(fixture: Fixture) {
  return fixture.requests.flatMap((request): Array<[string, string]> => {
    const match = /^\/api\/session\/[^/]+\/permission\/([^/]+)\/reply$/.exec(request.path)
    if (!match?.[1] || !request.body || typeof request.body !== "object") return []
    const reply = Reflect.get(request.body, "reply")
    return typeof reply === "string" ? [[decodeURIComponent(match[1]), reply]] : []
  })
}
