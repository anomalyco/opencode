import { describe, expect, test } from "bun:test"
import type { AgentSideConnection, RequestPermissionRequest, RequestPermissionResponse } from "@agentclientprotocol/sdk"
import { streamTurn } from "../../src/acp/event"
import { createSseFixture, durableEvent, ephemeralEvent, withTimeout } from "./sse-fixture"

type SessionUpdateParams = Parameters<AgentSideConnection["sessionUpdate"]>[0]
type Connection = Pick<AgentSideConnection, "sessionUpdate" | "requestPermission">
type Fixture = ReturnType<typeof createSseFixture>

describe("acp permission behavior", () => {
  test("forwards allow-once and allow-always selections to the generated client", async () => {
    const permissionRequests: RequestPermissionRequest[] = []
    const fixture = createSseFixture({
      onPrompt({ id, send }) {
        send(durableEvent("session.input.promoted", { sessionID: "ses_allow", inputID: id }))
        send(
          permissionAsked("ses_allow", "perm_once", {
            action: "shell",
            metadata: { command: "printf hello" },
            source: { type: "tool", messageID: "msg_allow", callID: "call_once" },
          }),
        )
        send(
          permissionAsked("ses_allow", "perm_always", {
            action: "read",
            metadata: { filePath: "/workspace/file.ts" },
            source: { type: "tool", messageID: "msg_allow", callID: "call_always" },
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
          title: "read",
          kind: "read",
          locations: [{ path: "/workspace/file.ts" }],
          rawInput: { filePath: "/workspace/file.ts" },
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

function startTurn(fixture: Fixture, connection: Connection, sessionID: string, inputID: string) {
  return streamTurn({
    client: fixture.client,
    connection,
    sessionID,
    cwd: "/workspace",
    start: { type: "input", id: inputID },
    control: { cancelled: false, admission: new AbortController() },
    submit: (signal) => fixture.client.session.prompt({ sessionID, id: inputID, text: "hello" }, { signal }),
  })
}

function permissionAsked(
  sessionID: string,
  id: string,
  input: {
    readonly action?: string
    readonly metadata?: Record<string, string>
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
  } = {},
) {
  return ephemeralEvent("permission.v2.asked", {
    id,
    sessionID,
    action: input.action ?? "shell",
    resources: ["*"],
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
