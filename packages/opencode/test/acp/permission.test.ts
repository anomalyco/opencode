import { describe, expect, it } from "bun:test"
import type {
  AgentSideConnection,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionUpdate,
} from "@agentclientprotocol/sdk"
import type { Event, OpencodeClient } from "@opencode-ai/sdk/v2"
import { Effect, ManagedRuntime } from "effect"
import { ACPEvent } from "@/acp/event"
import { ACPPermission } from "@/acp/permission"
import { ACPSession } from "@/acp/session"
import { SessionResolver } from "@/acp/session-resolve"

type PermissionEvent = Extract<Event, { type: "permission.asked" }>
type PermissionReplyParams = Parameters<OpencodeClient["permission"]["reply"]>[0]
type SessionUpdateParams = Parameters<AgentSideConnection["sessionUpdate"]>[0]

const pollUntil = async (
  check: () => boolean | Promise<boolean>,
  message: string,
  opts?: { timeoutMs?: number; intervalMs?: number },
) => {
  const started = Date.now()
  while (true) {
    if (await check()) return
    if (Date.now() - started > (opts?.timeoutMs ?? 2000)) throw new Error(message)
    await new Promise((resolve) => setTimeout(resolve, opts?.intervalMs ?? 5))
  }
}

function makeSessionService() {
  return ManagedRuntime.make(ACPSession.defaultLayer).runSync(
    ACPSession.Service.use((service) => Effect.succeed(service)),
  )
}

function createHarness(
  requestPermission: (params: RequestPermissionRequest) => Promise<RequestPermissionResponse> = () =>
    Promise.resolve({ outcome: { outcome: "selected", optionId: "once" } }),
  sdkSessionGet?: OpencodeClient["session"]["get"],
) {
  const replies: PermissionReplyParams[] = []
  const requests: RequestPermissionRequest[] = []
  const updates: SessionUpdateParams[] = []
  const session = makeSessionService()
  const sdk = {
    permission: {
      reply: (params: PermissionReplyParams) => {
        replies.push(params)
        return Promise.resolve({ data: true })
      },
    },
    session: {
      message: () => Promise.resolve({ data: undefined }),
      get: (sdkSessionGet ??
        (() => Promise.resolve({ data: undefined }))) as OpencodeClient["session"]["get"],
    },
  } as unknown as OpencodeClient
  const connection = {
    requestPermission: (params: RequestPermissionRequest) => {
      requests.push(params)
      return requestPermission(params)
    },
    sessionUpdate: (params: SessionUpdateParams) => {
      updates.push(params)
      return Promise.resolve()
    },
  } satisfies Pick<AgentSideConnection, "requestPermission" | "sessionUpdate">
  const subscription = new ACPEvent.Subscription({ sdk, connection, session })

  return { connection, replies, requests, sdk, session, subscription, updates }
}

async function createSession(session: ACPSession.Interface, sessionId: string, cwd = "/workspace") {
  await Effect.runPromise(session.create({ id: sessionId, cwd }))
}

async function createKnownTextPart(
  session: ACPSession.Interface,
  sessionId: string,
  messageId: string,
  partId: string,
) {
  await Effect.runPromise(
    session.recordPartMetadata({
      sessionId,
      messageId,
      partId,
      partType: "text",
      role: "assistant",
    }),
  )
}

function permissionAsked(
  sessionID: string,
  id: string,
  input: {
    permission?: string
    metadata?: Record<string, unknown>
    tool?: { messageID: string; callID: string }
  } = {},
) {
  return {
    id: `evt_${id}`,
    type: "permission.asked",
    properties: {
      id,
      sessionID,
      permission: input.permission ?? "bash",
      patterns: ["*"],
      metadata: input.metadata ?? { command: "printf hello" },
      always: [],
      ...(input.tool ? { tool: input.tool } : {}),
    },
  } as PermissionEvent
}

function textDelta(sessionID: string, messageID: string, partID: string, delta: string) {
  return {
    id: `evt_${sessionID}_${messageID}_${partID}`,
    type: "message.part.delta",
    properties: {
      sessionID,
      messageID,
      partID,
      field: "text",
      delta,
    },
  } as Event
}

function textFromUpdates(updates: SessionUpdateParams[], sessionId: string) {
  return updates
    .filter((item) => item.sessionId === sessionId)
    .map((item) => item.update)
    .filter((update): update is Extract<SessionUpdate, { sessionUpdate: "agent_message_chunk" }> => {
      return update.sessionUpdate === "agent_message_chunk"
    })
    .map((update) => (update.content.type === "text" ? update.content.text : ""))
    .join("")
}

describe("acp permissions", () => {
  it("sends requestPermission and replies with the selected outcome", async () => {
    const harness = createHarness()
    await createSession(harness.session, "ses_a")

    harness.subscription.handle(permissionAsked("ses_a", "perm_1", { tool: { messageID: "msg_1", callID: "call_1" } }))

    await pollUntil(() => harness.replies.length === 1, "permission was never replied")

    expect(harness.requests[0]).toMatchObject({
      sessionId: "ses_a",
      toolCall: {
        toolCallId: "call_1",
        status: "pending",
        title: "bash",
        rawInput: { command: "printf hello" },
        kind: "execute",
        locations: [],
      },
      options: [
        { optionId: "once", kind: "allow_once", name: "Allow once" },
        { optionId: "always", kind: "allow_always", name: "Always allow" },
        { optionId: "reject", kind: "reject_once", name: "Reject" },
      ],
    })
    expect(harness.replies).toEqual([{ requestID: "perm_1", reply: "once", directory: "/workspace" }])
  })

  it("forwards external_directory metadata and locations to requestPermission", async () => {
    const harness = createHarness()
    await createSession(harness.session, "ses_a")

    harness.subscription.handle(
      permissionAsked("ses_a", "perm_external", {
        permission: "external_directory",
        metadata: {
          command: "mkdir -p /tmp/outside",
          description: "Create external directory",
          directories: ["/tmp/outside"],
          patterns: ["/tmp/outside/*"],
        },
        tool: { messageID: "msg_1", callID: "call_1" },
      }),
    )

    await pollUntil(() => harness.replies.length === 1, "external_directory permission was never replied")

    expect(harness.requests[0]).toMatchObject({
      sessionId: "ses_a",
      toolCall: {
        toolCallId: "call_1",
        status: "pending",
        title: "external_directory",
        rawInput: {
          command: "mkdir -p /tmp/outside",
          description: "Create external directory",
          directories: ["/tmp/outside"],
          patterns: ["/tmp/outside/*"],
        },
        locations: [{ path: "/tmp/outside" }],
      },
    })
  })

  it("routes child-session permission prompts through the root ACP session", async () => {
    const harness = createHarness()
    await createSession(harness.session, "ses_root")
    await Effect.runPromise(
      harness.session.registerChild({
        sessionId: "ses_child",
        parentSessionId: "ses_root",
      }),
    )

    harness.subscription.handle(
      permissionAsked("ses_child", "perm_child", {
        metadata: { command: "ps aux" },
        tool: { messageID: "msg_1", callID: "call_child" },
      }),
    )

    await pollUntil(() => harness.replies.length === 1, "child permission was never replied")

    expect(harness.requests[0]).toMatchObject({
      sessionId: "ses_root",
      toolCall: {
        toolCallId: "call_child",
        rawInput: { command: "ps aux", childSessionId: "ses_child" },
      },
    })
    expect(harness.replies[0]).toEqual({ requestID: "perm_child", reply: "once", directory: "/workspace" })
  })

  it("auto-resolves child permissions through the SDK parent chain", async () => {
    const harness = createHarness(undefined, ((input) =>
      Promise.resolve({
        data:
          input.sessionID === "ses_child"
            ? {
                id: "ses_child",
                parentID: "ses_root",
                directory: "/workspace",
              }
            : undefined,
      })) as OpencodeClient["session"]["get"])
    await createSession(harness.session, "ses_root")

    harness.subscription.handle(
      permissionAsked("ses_child", "perm_resolved", {
        metadata: { command: "ps aux" },
        tool: { messageID: "msg_1", callID: "call_resolved" },
      }),
    )

    await pollUntil(() => harness.replies.length === 1, "resolved child permission was never replied")

    expect(harness.requests[0]).toMatchObject({
      sessionId: "ses_root",
      toolCall: {
        toolCallId: "call_resolved",
        rawInput: { command: "ps aux", childSessionId: "ses_child" },
      },
    })
  })

  it("routes concurrent child permission prompts from sibling subagents to the root session", async () => {
    const harness = createHarness()
    await createSession(harness.session, "ses_root")
    await Effect.runPromise(
      harness.session.registerChild({
        sessionId: "ses_child_a",
        parentSessionId: "ses_root",
      }),
    )
    await Effect.runPromise(
      harness.session.registerChild({
        sessionId: "ses_child_b",
        parentSessionId: "ses_root",
      }),
    )

    harness.subscription.handle(
      permissionAsked("ses_child_a", "perm_a", {
        metadata: { command: "ps aux" },
        tool: { messageID: "msg_a", callID: "call_a" },
      }),
    )
    harness.subscription.handle(
      permissionAsked("ses_child_b", "perm_b", {
        metadata: { command: "ls" },
        tool: { messageID: "msg_b", callID: "call_b" },
      }),
    )

    await pollUntil(() => harness.requests.length === 2, "sibling child permissions were not both requested")
    await pollUntil(() => harness.replies.length === 2, "sibling child permissions were not both replied")

    expect(harness.requests.map((request) => request.sessionId)).toEqual(["ses_root", "ses_root"])
    expect(harness.requests.map((request) => request.toolCall.rawInput)).toEqual([
      { command: "ps aux", childSessionId: "ses_child_a" },
      { command: "ls", childSessionId: "ses_child_b" },
    ])
  })

  it("routes grandchild permission prompts through the root ACP session", async () => {
    const session = makeSessionService()
    await createSession(session, "ses_root")
    const resolver = new SessionResolver(
      session,
      {
        session: {
          get: (input: { sessionID: string }) =>
            Promise.resolve({
              data:
                input.sessionID === "ses_grandchild"
                  ? {
                      id: "ses_grandchild",
                      parentID: "ses_child",
                      directory: "/workspace",
                    }
                  : input.sessionID === "ses_child"
                    ? {
                        id: "ses_child",
                        parentID: "ses_root",
                        directory: "/workspace",
                      }
                    : undefined,
            }),
        },
      } as unknown as OpencodeClient,
    )
    const replies: PermissionReplyParams[] = []
    const requests: RequestPermissionRequest[] = []
    const handler = new ACPPermission.Handler({
      sdk: {
        permission: {
          reply: (params: PermissionReplyParams) => {
            replies.push(params)
            return Promise.resolve({ data: true })
          },
        },
      } as unknown as OpencodeClient,
      connection: {
        requestPermission: (params: RequestPermissionRequest) => {
          requests.push(params)
          return Promise.resolve({ outcome: { outcome: "selected", optionId: "once" } })
        },
      },
      session,
      resolver,
    })

    handler.handle(
      permissionAsked("ses_grandchild", "perm_grandchild", {
        metadata: { command: "printf nested" },
        tool: { messageID: "msg_gc", callID: "call_gc" },
      }),
    )

    await pollUntil(() => replies.length === 1, "grandchild permission was never replied")

    expect(requests[0]).toMatchObject({
      sessionId: "ses_root",
      toolCall: {
        toolCallId: "call_gc",
        rawInput: { command: "printf nested", childSessionId: "ses_grandchild" },
      },
    })
  })

  it("rejects non-selected outcomes", async () => {
    const harness = createHarness(() => Promise.resolve({ outcome: { outcome: "cancelled" } }))
    await createSession(harness.session, "ses_a")

    harness.subscription.handle(permissionAsked("ses_a", "perm_cancelled"))

    await pollUntil(() => harness.replies.length === 1, "cancelled permission was never replied")

    expect(harness.replies[0]).toMatchObject({ requestID: "perm_cancelled", reply: "reject" })
  })

  it("rejects when requestPermission fails", async () => {
    const harness = createHarness(() => Promise.reject(new Error("client permission UI failed")))
    await createSession(harness.session, "ses_a")

    harness.subscription.handle(permissionAsked("ses_a", "perm_failed"))

    await pollUntil(() => harness.replies.length === 1, "failed permission was never rejected")

    expect(harness.replies[0]).toMatchObject({ requestID: "perm_failed", reply: "reject" })
  })

  it("does not let a blocked session A permission block session B message updates", async () => {
    let releasePermission: (() => void) | undefined
    const blocked = new Promise<RequestPermissionResponse>((resolve) => {
      releasePermission = () => resolve({ outcome: { outcome: "selected", optionId: "once" } })
    })
    const harness = createHarness(() => blocked)
    await createSession(harness.session, "ses_a")
    await createSession(harness.session, "ses_b")
    await createKnownTextPart(harness.session, "ses_b", "msg_b", "part_b")

    harness.subscription.handle(permissionAsked("ses_a", "perm_blocked"))
    await pollUntil(() => harness.requests.length === 1, "blocked permission was never requested")

    await harness.subscription.handle(textDelta("ses_b", "msg_b", "part_b", "session_b_message"))

    expect(textFromUpdates(harness.updates, "ses_b")).toBe("session_b_message")
    expect(harness.replies).toHaveLength(0)

    releasePermission?.()
    await pollUntil(() => harness.replies.length === 1, "blocked permission was never replied after release")
  })

  it("serializes permission requests per session", async () => {
    let releaseFirst: (() => void) | undefined
    const first = new Promise<RequestPermissionResponse>((resolve) => {
      releaseFirst = () => resolve({ outcome: { outcome: "selected", optionId: "once" } })
    })
    const harness = createHarness(() =>
      harness.requests.length === 1 ? first : Promise.resolve({ outcome: { outcome: "selected", optionId: "always" } }),
    )
    await createSession(harness.session, "ses_a")

    harness.subscription.handle(permissionAsked("ses_a", "perm_1"))
    harness.subscription.handle(permissionAsked("ses_a", "perm_2"))

    await pollUntil(() => harness.requests.length === 1, "first permission was never requested")
    expect(harness.requests.map((request) => request.toolCall.toolCallId)).toEqual(["perm_1"])

    releaseFirst?.()
    await pollUntil(() => harness.requests.length === 2, "second permission was not requested after first resolved")
    await pollUntil(() => harness.replies.length === 2, "serialized permissions were not both replied")

    expect(harness.replies.map((reply) => [reply.requestID, reply.reply])).toEqual([
      ["perm_1", "once"],
      ["perm_2", "always"],
    ])
  })
})
