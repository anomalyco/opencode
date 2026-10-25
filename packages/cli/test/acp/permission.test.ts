import { describe, expect, test } from "bun:test"
import type { AnyRequest, CreateElicitationResponse, RequestPermissionResponse } from "@agentclientprotocol/sdk"
import type { OpenCodeEventEncoded } from "@opencode/protocol/groups/event"
import fs from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../fixture/tmpdir"
import {
  delivered,
  fileDiff,
  ephemeralEvent,
  interrupted,
  permissionAsked,
  startSession,
  startWire,
  succeeded,
  toolCalled,
  toolStarted,
  turn,
  type Wire,
} from "./wire-fixture"

const allowOnce = () => ({ outcome: { outcome: "selected", optionId: "once" } }) as const

describe("acp permissions over the wire", () => {
  test("forwards allow-once and allow-always selections to the server", async () => {
    const selections: Record<string, () => RequestPermissionResponse> = {
      call_once: allowOnce,
      call_always: () => ({ outcome: { outcome: "selected", optionId: "always" } }),
      perm_selected_reject: () => ({ outcome: { outcome: "selected", optionId: "reject" } }),
      perm_cancelled: () => ({ outcome: { outcome: "cancelled" } }),
      perm_failed: () => {
        throw new Error("client permission UI failed")
      },
    }
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
          permissionAsked(sessionID, "perm_selected_reject"),
          permissionAsked(sessionID, "perm_cancelled"),
          permissionAsked(sessionID, "perm_failed"),
        ),
      permission: (request) => selections[request.toolCall.toolCallId](),
    })

    expect(await acp.prompt(acp.sessionId, "hello")).toMatchObject({ stopReason: "end_turn" })

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
      ["perm_selected_reject", "reject"],
      ["perm_cancelled", "reject"],
      ["perm_failed", "reject"],
    ])
  })

  test.each<[string, string, string, (sessionID: string, id: string) => OpenCodeEventEncoded]>([
    ["session/request_permission", "perm", "reject", (sessionID, id) => permissionAsked(sessionID, id)],
    ["elicitation/create", "frm", "cancelled", (sessionID, id) => question(sessionID, id)],
  ])(
    "cancelling the turn cancels its pending %s and settles queued asks without sending them",
    async (method, prefix, outcome, ask) => {
      const pendingUntilAborted =
        <Response>(cancelled: Response) =>
        (_request: unknown, signal: AbortSignal) =>
          new Promise<Response>((resolve) => signal.addEventListener("abort", () => resolve(cancelled), { once: true }))
      await using acp = await startSession({
        capabilities: { elicitation: true },
        onPrompt: ({ sessionID, id }) => [
          delivered(sessionID, id),
          ask(sessionID, `${prefix}_pending`),
          ask(sessionID, `${prefix}_queued`),
        ],
        onInterrupt: ({ sessionID }) => [interrupted(sessionID)],
        permission: pendingUntilAborted<RequestPermissionResponse>({ outcome: { outcome: "cancelled" } }),
        elicitation: pendingUntilAborted<CreateElicitationResponse>({ action: "cancel" }),
      })

      const prompt = acp.prompt(acp.sessionId, "hello")
      await acp.until(() => acp.permissions.length + acp.elicitations.length === 1, "the pending ask")
      await acp.notify("session/cancel", { sessionId: acp.sessionId })

      expect(await prompt).toMatchObject({ stopReason: "cancelled" })
      const settled = () => [
        ...acp.server.replies.map((reply) => [reply.requestID, reply.decision]),
        ...acp.server.cancelledForms.map((form) => [form.formID, "cancelled"]),
      ]
      await acp.until(() => settled().length === 2, "both asks settled")
      expect(settled()).toEqual([
        [`${prefix}_pending`, outcome],
        [`${prefix}_queued`, outcome],
      ])
      expect(acp.server.repliedForms).toEqual([])
      const asked = acp.received.filter(
        (message): message is AnyRequest => "method" in message && "id" in message && message.method === method,
      )
      expect(asked).toHaveLength(1)
      expect(acp.received).toContainEqual({
        jsonrpc: "2.0",
        method: "$/cancel_request",
        params: { requestId: asked[0]?.id },
      })
    },
  )
  test("withdraws permission requests settled elsewhere and still asks the remaining one", async () => {
    await using acp = await startSession({
      onPrompt: ({ sessionID, id }) => [
        delivered(sessionID, id),
        permissionAsked(sessionID, "perm_elsewhere"),
        permissionAsked(sessionID, "perm_queued"),
        permissionAsked(sessionID, "perm_remaining"),
      ],
      fetch: (request) => {
        if (request.path.endsWith("/permission/perm_remaining/reply")) acp.server.send(succeeded(acp.sessionId))
        return undefined
      },
      permission: (_request, signal) =>
        acp.permissions.length === 1
          ? new Promise((resolve) => {
              signal.addEventListener("abort", () => resolve({ outcome: { outcome: "cancelled" } }), { once: true })
            })
          : allowOnce(),
    })

    const prompt = acp.prompt(acp.sessionId, "hello")
    await acp.until(() => acp.permissions.length === 1, "permission request")
    acp.server.send(
      ephemeralEvent("permission.replied", { sessionID: acp.sessionId, requestID: "perm_queued", reply: "always" }),
      ephemeralEvent("permission.replied", { sessionID: acp.sessionId, requestID: "perm_elsewhere", reply: "always" }),
    )

    expect(await prompt).toMatchObject({ stopReason: "end_turn" })
    expect(acp.permissions.map((request) => request.toolCall.toolCallId)).toEqual(["perm_elsewhere", "perm_remaining"])
    expect(decisions(acp)).toEqual([["perm_remaining", "once"]])
    const cancels = acp.received.filter((message) => "method" in message && message.method === "$/cancel_request")
    expect(cancels).toHaveLength(1)
    expect(acp.logs).toEqual([])
  })
})

describe("acp edit previews over the wire", () => {
  test("previews added files as new and deleted files as empty", async () => {
    await using dir = await tmpdir()
    await Promise.all(
      Object.entries({
        "file.ts": "one\r\ntwo\r\n",
        "first.ts": "one\n",
        "second.ts": "alpha\n",
        "gone.ts": "gone\n",
        "stale.ts": "changed\n",
        "unpatched.ts": "changed\n",
      }).map(([name, content]) => fs.writeFile(path.join(dir.path, name), content)),
    )
    await fs.mkdir(path.join(dir.path, "folder"))
    const file = (name: string) => path.join(dir.path, name)
    const patch = (...lines: string[]) => ["*** Begin Patch", ...lines, "*** End Patch"].join("\n")
    const edit = (sessionID: string, call: string, tool: string, input: Record<string, unknown>, metadata = {}) => [
      toolStarted(sessionID, call, tool),
      toolCalled(sessionID, call, input),
      permissionAsked(sessionID, `perm_${call}`, {
        action: "edit",
        metadata,
        source: { type: "tool", messageID: "msg_edit", id: call },
      }),
    ]
    await using acp = await startWire({
      onPrompt: ({ sessionID, id }) =>
        turn(
          sessionID,
          id,
          ...edit(
            sessionID,
            "call_edit",
            "edit",
            { path: "file.ts", oldString: "one\ntwo", newString: "one\nthree" },
            { files: [fileDiff("file.ts", "one\r\ntwo\r\n", "one\r\nthree\r\n")] },
          ),
          ...edit(sessionID, "call_patch", "patch", {
            patchText: patch(
              "*** Update File: first.ts",
              "@@",
              "-one",
              "+two",
              "*** Update File: second.ts",
              "@@",
              "-alpha",
              "+beta",
            ),
          }),
          ...edit(
            sessionID,
            "call_write",
            "write",
            { path: "written.ts", content: "two\n" },
            { files: [fileDiff("written.ts", "", "two\n", "added")] },
          ),
          ...edit(sessionID, "call_add", "patch", { patchText: patch("*** Add File: added.ts", "+one") }),
          permissionAsked(sessionID, "perm_delete", {
            action: "edit",
            metadata: { files: [fileDiff("gone.ts", "gone\n", "", "deleted")] },
          }),
          permissionAsked(sessionID, "perm_stale", {
            action: "edit",
            resources: ["stale.ts"],
            metadata: { files: [fileDiff("stale.ts", "one\n", "two\n")] },
          }),
          permissionAsked(sessionID, "perm_folder", {
            action: "edit",
            resources: ["folder"],
            metadata: { files: [fileDiff("folder", "one\n", "two\n")] },
          }),
          ...edit(sessionID, "call_unpatched", "patch", {
            patchText: patch("*** Update File: unpatched.ts", "@@", "-one", "+two"),
          }),
        ),
      permission: allowOnce,
    })
    await acp.initialize()
    const session = await acp.newSession(dir.path)

    await acp.prompt(session.sessionId, "hello")

    expect(acp.permissions.map((request) => request.toolCall.content)).toEqual([
      [{ type: "diff", path: file("file.ts"), oldText: "one\r\ntwo\r\n", newText: "one\r\nthree\r\n" }],
      [
        { type: "diff", path: file("first.ts"), oldText: "one\n", newText: "two\n" },
        { type: "diff", path: file("second.ts"), oldText: "alpha\n", newText: "beta\n" },
      ],
      [{ type: "diff", path: file("written.ts"), oldText: null, newText: "two\n" }],
      [{ type: "diff", path: file("added.ts"), oldText: null, newText: "one\n" }],
      [{ type: "diff", path: file("gone.ts"), oldText: "gone\n", newText: "" }],
      undefined,
      undefined,
      undefined,
    ])
    expect(acp.permissions.slice(0, 2).map((request) => request.toolCall)).toMatchObject([
      { title: "file.ts", kind: "edit", locations: [{ path: file("file.ts") }] },
      { title: "2 files", kind: "edit", locations: [{ path: file("first.ts") }, { path: file("second.ts") }] },
    ])
    expect(acp.permissions.slice(5).map((request) => request.toolCall.locations)).toEqual([
      [{ path: file("stale.ts") }],
      [{ path: file("folder") }],
      [{ path: file("unpatched.ts") }],
    ])
    expect(acp.permissions[0]?.toolCall.name).toBe("edit")
    expect(acp.permissions[4]?.toolCall).not.toHaveProperty("name")
    expect(decisions(acp)).toHaveLength(8)
  })
})

function question(sessionID: string, id: string) {
  return ephemeralEvent("form.created", {
    form: {
      id,
      sessionID,
      title: "Questions",
      metadata: { kind: "question" },
      fields: [{ key: "q0", title: "Runtime", type: "string", options: [{ value: "Bun", label: "Bun" }] }],
    },
  })
}

function decisions(acp: Wire) {
  return acp.server.replies.map((reply) => [reply.requestID, reply.decision])
}

