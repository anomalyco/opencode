import { afterEach, describe, expect, it } from "bun:test"
import type {
  AgentSideConnection,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionUpdate,
} from "@agentclientprotocol/sdk"
import type { Event, OpencodeClient } from "@opencode-ai/sdk/v2"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { createTwoFilesPatch } from "diff"
import { Effect, ManagedRuntime } from "effect"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { ACPEvent } from "@/acp/event"
import { ACPPermission } from "@/acp/permission"
import { ACPSession } from "@/acp/session"

type PermissionEvent = Extract<Event, { type: "permission.asked" }>
type PermissionReplyParams = Parameters<OpencodeClient["permission"]["reply"]>[0]
type SessionUpdateParams = Parameters<AgentSideConnection["sessionUpdate"]>[0]
const cleanupDirs: string[] = []

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

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
  return ManagedRuntime.make(LayerNode.compile(ACPSession.node)).runSync(
    ACPSession.Service.use((service) => Effect.succeed(service)),
  )
}

function createHarness(
  input: {
    requestPermission?: (params: RequestPermissionRequest) => Promise<RequestPermissionResponse>
    sessionGet?: (sessionID: string) => Promise<{ parentID?: string }>
    permissionReply?: (params: PermissionReplyParams) => Promise<{ data?: boolean; error?: unknown }>
  } = {},
) {
  const replies: PermissionReplyParams[] = []
  const requests: RequestPermissionRequest[] = []
  const updates: SessionUpdateParams[] = []
  const session = makeSessionService()
  const sdk = {
    permission: {
      reply: (params: PermissionReplyParams) => {
        replies.push(params)
        return input.permissionReply?.(params) ?? Promise.resolve({ data: true })
      },
    },
    session: {
      message: () => Promise.resolve({ data: undefined }),
      get: (params: { sessionID: string }) =>
        (
          input.sessionGet?.(params.sessionID) ??
          Promise.reject(new Error(`unexpected session lookup: ${params.sessionID}`))
        ).then((data) => ({ data })),
    },
  } as unknown as OpencodeClient
  const connection = {
    requestPermission: (params: RequestPermissionRequest) => {
      requests.push(params)
      return (
        input.requestPermission?.(params) ?? Promise.resolve({ outcome: { outcome: "selected", optionId: "once" } })
      )
    },
    sessionUpdate: (params: SessionUpdateParams) => {
      updates.push(params)
      return Promise.resolve()
    },
  } satisfies Pick<AgentSideConnection, "requestPermission" | "sessionUpdate">
  const subscription = new ACPEvent.Subscription({ sdk, connection, session })
  const handler = new ACPPermission.Handler({ sdk, connection, session })

  return { connection, handler, replies, requests, sdk, session, subscription, updates }
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

async function tempFile(name: string, content: string) {
  const dir = await mkdtemp(path.join(tmpdir(), "opencode-acp-permission-"))
  cleanupDirs.push(dir)
  const file = path.join(dir, name)
  await Bun.write(file, content)
  return file
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
        title: "printf hello",
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

  it("uses permission metadata for non-shell titles", async () => {
    const harness = createHarness()
    await createSession(harness.session, "ses_a")

    harness.subscription.handle(
      permissionAsked("ses_a", "perm_fetch", {
        permission: "webfetch",
        metadata: {
          url: "https://example.com/docs",
          format: "markdown",
        },
        tool: { messageID: "msg_1", callID: "call_1" },
      }),
    )

    await pollUntil(() => harness.replies.length === 1, "webfetch permission was never replied")

    expect(harness.requests[0]?.toolCall).toMatchObject({
      toolCallId: "call_1",
      title: "https://example.com/docs",
      kind: "fetch",
      rawInput: { url: "https://example.com/docs", format: "markdown" },
    })
  })

  it("includes a diff content block for edit permission metadata", async () => {
    const filepath = await tempFile("file.ts", "before\n")
    const harness = createHarness()
    await createSession(harness.session, "ses_a")

    harness.subscription.handle(
      permissionAsked("ses_a", "perm_edit", {
        permission: "edit",
        metadata: {
          filepath,
          diff: createTwoFilesPatch(filepath, filepath, "before\n", "after\n"),
        },
        tool: { messageID: "msg_1", callID: "call_1" },
      }),
    )

    await pollUntil(() => harness.replies.length === 1, "edit permission was never replied")

    expect(harness.requests[0]?.toolCall).toMatchObject({
      toolCallId: "call_1",
      title: filepath,
      kind: "edit",
      locations: [{ path: filepath }],
      content: [
        {
          type: "diff",
          path: filepath,
          oldText: "before\n",
          newText: "after\n",
        },
      ],
    })
  })

  it("includes per-file diff blocks and locations for apply_patch permission metadata", async () => {
    const first = await tempFile("first.ts", "one\n")
    const second = await tempFile("second.ts", "alpha\n")
    const harness = createHarness()
    await createSession(harness.session, "ses_a")

    harness.subscription.handle(
      permissionAsked("ses_a", "perm_patch", {
        permission: "edit",
        metadata: {
          filepath: "first.ts, second.ts",
          files: [
            {
              filePath: first,
              relativePath: "first.ts",
              patch: createTwoFilesPatch(first, first, "one\n", "two\n"),
            },
            {
              filePath: second,
              relativePath: "second.ts",
              patch: createTwoFilesPatch(second, second, "alpha\n", "beta\n"),
            },
          ],
        },
        tool: { messageID: "msg_1", callID: "call_1" },
      }),
    )

    await pollUntil(() => harness.replies.length === 1, "apply_patch permission was never replied")

    expect(harness.requests[0]?.toolCall).toMatchObject({
      toolCallId: "call_1",
      title: "2 files",
      locations: [{ path: first }, { path: second }],
      content: [
        {
          type: "diff",
          path: first,
          oldText: "one\n",
          newText: "two\n",
        },
        {
          type: "diff",
          path: second,
          oldText: "alpha\n",
          newText: "beta\n",
        },
      ],
    })
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
        title: "Create external directory",
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

  it("rejects non-selected outcomes", async () => {
    const harness = createHarness({
      requestPermission: () => Promise.resolve({ outcome: { outcome: "cancelled" } }),
    })
    await createSession(harness.session, "ses_a")

    harness.subscription.handle(permissionAsked("ses_a", "perm_cancelled"))

    await pollUntil(() => harness.replies.length === 1, "cancelled permission was never replied")

    expect(harness.replies[0]).toMatchObject({ requestID: "perm_cancelled", reply: "reject" })
  })

  it("rejects when requestPermission fails", async () => {
    const harness = createHarness({
      requestPermission: () => Promise.reject(new Error("client permission UI failed")),
    })
    await createSession(harness.session, "ses_a")

    harness.subscription.handle(permissionAsked("ses_a", "perm_failed"))

    await pollUntil(() => harness.replies.length === 1, "failed permission was never rejected")

    expect(harness.replies[0]).toMatchObject({ requestID: "perm_failed", reply: "reject" })
  })

  it("routes a nested permission through its managed ancestor", async () => {
    const parents = new Map<string, string | undefined>([
      ["ses_leaf", "ses_middle"],
      ["ses_middle", "ses_root"],
    ])
    const harness = createHarness({
      sessionGet: async (sessionID) => {
        if (!parents.has(sessionID)) throw new Error(`unexpected session lookup: ${sessionID}`)
        return { parentID: parents.get(sessionID) }
      },
    })
    await createSession(harness.session, "ses_root")

    harness.subscription.handle(permissionAsked("ses_leaf", "perm_nested"))

    await pollUntil(() => harness.replies.length === 1, "nested permission was never replied")
    expect(harness.requests).toHaveLength(1)
    expect(harness.requests[0]?.sessionId).toBe("ses_root")
    expect(harness.replies[0]).toMatchObject({ requestID: "perm_nested", reply: "once" })
  })

  it("rejects a permission whose ancestry never resolves", async () => {
    // Permission.ask waits on a deferred with no timeout, so an ancestry that
    // can never resolve — a parent chain cycle, or a parentID pointing at a
    // deleted session — hangs the nested tool call forever unless the retry is
    // bounded and exhaustion answers the request.
    const harness = createHarness({
      sessionGet: (sessionID) => Promise.resolve({ parentID: sessionID === "ses_leaf" ? "ses_mid" : "ses_leaf" }),
    })
    await createSession(harness.session, "ses_root")

    harness.handler.handle(permissionAsked("ses_leaf", "perm_cycle"), "/remote/workspace")

    await pollUntil(() => harness.replies.length === 1, "unresolvable permission was never answered", {
      timeoutMs: 20_000,
    })
    expect(harness.replies[0]).toEqual({
      requestID: "perm_cycle",
      reply: "reject",
      directory: "/remote/workspace",
    })
    expect(harness.requests).toHaveLength(0)
  }, 30_000)

  it("treats a missing permission request as already answered", async () => {
    // The server drops pending requests when a session aborts and rejects the
    // cascade itself, so losing that race must not surface as a failure.
    const harness = createHarness({
      sessionGet: () => Promise.resolve({ parentID: undefined }),
      permissionReply: () =>
        Promise.reject({ _tag: "PermissionNotFoundError", requestID: "perm_gone", message: "gone" }),
    })
    await createSession(harness.session, "ses_root")

    harness.handler.handle(permissionAsked("ses_root", "perm_gone"))

    await pollUntil(() => harness.replies.length === 1, "permission was never replied")
    // One reply attempt, and no reject cascade from a thrown handler.
    await Bun.sleep(50)
    expect(harness.replies).toHaveLength(1)
  })

  it("cancels a retained unknown ownership retry without replying", async () => {
    let lookups = 0
    const harness = createHarness({
      sessionGet: () => {
        lookups += 1
        return Promise.reject(new Error("session service unavailable"))
      },
    })

    harness.handler.handle(permissionAsked("ses_leaf", "perm_lookup_failed"))

    await pollUntil(() => lookups >= 2, "ancestor lookup was not retained for retry")
    harness.handler.stop()
    const stoppedAt = lookups
    await Bun.sleep(250)
    expect(lookups).toBe(stoppedAt)
    expect(harness.requests).toHaveLength(0)
    expect(harness.replies).toHaveLength(0)
  })

  it("stops retained retries with the event subscription", async () => {
    let lookups = 0
    const harness = createHarness({
      sessionGet: () => {
        lookups += 1
        return Promise.reject(new Error("session service unavailable"))
      },
    })

    harness.subscription.handle(permissionAsked("ses_leaf", "perm_subscription_stop"))
    await pollUntil(() => lookups >= 2, "ancestor lookup was not retained for retry")
    harness.subscription.stop()
    const stoppedAt = lookups
    await Bun.sleep(250)

    expect(lookups).toBe(stoppedAt)
    expect(harness.requests).toHaveLength(0)
  })

  it("does not let a retained unknown ownership retry block an owned permission", async () => {
    let lookups = 0
    const harness = createHarness({
      sessionGet: () => {
        lookups += 1
        return Promise.reject(new Error("session service unavailable"))
      },
    })
    await createSession(harness.session, "ses_owned")

    harness.handler.handle(permissionAsked("ses_unknown", "perm_unknown"))
    await pollUntil(() => lookups >= 1, "unknown ancestry lookup did not start")
    harness.handler.handle(permissionAsked("ses_owned", "perm_owned"))

    await pollUntil(
      () => harness.replies.some((reply) => reply.requestID === "perm_owned"),
      "owned permission was blocked",
    )
    harness.handler.stop()
    expect(harness.requests).toHaveLength(1)
    expect(harness.replies).toEqual([
      expect.objectContaining({ requestID: "perm_owned", reply: "once", directory: expect.any(String) }),
    ])
  })

  it("does not reply to a foreign session permission", async () => {
    let lookups = 0
    const harness = createHarness({
      sessionGet: async () => {
        lookups += 1
        return { parentID: undefined }
      },
    })

    harness.subscription.handle(permissionAsked("ses_foreign", "perm_foreign"))

    await pollUntil(() => lookups === 1, "foreign ancestry was never resolved")
    expect(harness.requests).toHaveLength(0)
    expect(harness.replies).toHaveLength(0)
  })

  it("eventually routes an owned permission after prolonged ancestry failures", async () => {
    let lookups = 0
    const harness = createHarness({
      sessionGet: async () => {
        lookups += 1
        if (lookups < 4) throw new Error("session service unavailable")
        return { parentID: "ses_root" }
      },
    })
    await createSession(harness.session, "ses_root")

    harness.subscription.handle(permissionAsked("ses_leaf", "perm_retry_owned"))

    await pollUntil(() => harness.replies.length === 1, "owned permission was not routed after ancestry retry", {
      timeoutMs: 3000,
    })
    expect(lookups).toBe(4)
    expect(harness.requests[0]?.sessionId).toBe("ses_root")
    expect(harness.replies[0]).toMatchObject({ requestID: "perm_retry_owned", reply: "once" })
  })

  it("rejects an owned permission when the SDK returns a reply error envelope", async () => {
    const harness = createHarness({
      permissionReply: async (params) =>
        params.reply === "once" ? { error: new Error("reply failed") } : { data: true },
    })
    await createSession(harness.session, "ses_a")

    harness.subscription.handle(permissionAsked("ses_a", "perm_reply_error"))

    await pollUntil(() => harness.replies.length === 2, "reply error envelope was not handled")
    expect(harness.replies.map((item) => item.reply)).toEqual(["once", "reject"])
  })

  it("does not let a blocked session A permission block session B message updates", async () => {
    let releasePermission: (() => void) | undefined
    const blocked = new Promise<RequestPermissionResponse>((resolve) => {
      releasePermission = () => resolve({ outcome: { outcome: "selected", optionId: "once" } })
    })
    const harness = createHarness({ requestPermission: () => blocked })
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
    const harness = createHarness({
      requestPermission: () =>
        harness.requests.length === 1
          ? first
          : Promise.resolve({ outcome: { outcome: "selected", optionId: "always" } }),
    })
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

  it("preserves permission order while resolving nested ownership", async () => {
    let releaseLookup: (() => void) | undefined
    const firstLookup = new Promise<void>((resolve) => {
      releaseLookup = resolve
    })
    let lookups = 0
    const harness = createHarness({
      sessionGet: async () => {
        lookups += 1
        if (lookups === 1) await firstLookup
        return { parentID: "ses_root" }
      },
    })
    await createSession(harness.session, "ses_root")

    harness.handler.handle(permissionAsked("ses_leaf", "perm_1"))
    harness.handler.handle(permissionAsked("ses_leaf", "perm_2"))

    await pollUntil(() => lookups === 1, "first ancestry lookup was never started")
    await Bun.sleep(25)
    expect(harness.requests).toHaveLength(0)

    releaseLookup?.()
    await pollUntil(() => harness.replies.length === 2, "ordered permissions were not both replied")
    expect(harness.requests.map((request) => request.toolCall.toolCallId)).toEqual(["perm_1", "perm_2"])
  })

  it("ignores a duplicate event while its permission is pending", async () => {
    let release: (() => void) | undefined
    const pending = new Promise<RequestPermissionResponse>((resolve) => {
      release = () => resolve({ outcome: { outcome: "selected", optionId: "once" } })
    })
    const harness = createHarness({ requestPermission: () => pending })
    await createSession(harness.session, "ses_a")
    const event = permissionAsked("ses_a", "perm_duplicate")

    harness.handler.handle(event)
    harness.handler.handle(event)
    await pollUntil(() => harness.requests.length === 1, "permission was never requested")
    release?.()
    await pollUntil(() => harness.replies.length === 1, "permission was never replied")

    expect(harness.requests).toHaveLength(1)
    expect(harness.replies).toHaveLength(1)
  })

  it("does not start queued permissions after stop", async () => {
    let release: (() => void) | undefined
    const first = new Promise<RequestPermissionResponse>((resolve) => {
      release = () => resolve({ outcome: { outcome: "selected", optionId: "once" } })
    })
    const harness = createHarness({
      requestPermission: () =>
        harness.requests.length === 1 ? first : Promise.resolve({ outcome: { outcome: "selected", optionId: "once" } }),
    })
    await createSession(harness.session, "ses_a")

    harness.handler.handle(permissionAsked("ses_a", "perm_active"))
    harness.handler.handle(permissionAsked("ses_a", "perm_queued"))
    await pollUntil(() => harness.requests.length === 1, "first permission was never requested")
    harness.handler.stop()
    release?.()
    await pollUntil(() => harness.replies.length === 1, "active permission was never replied")
    await Bun.sleep(50)

    expect(harness.requests).toHaveLength(1)
    expect(harness.replies[0]?.requestID).toBe("perm_active")
  })

  it("serializes sibling leaf permissions by managed ancestor", async () => {
    let releaseFirst: (() => void) | undefined
    const first = new Promise<RequestPermissionResponse>((resolve) => {
      releaseFirst = () => resolve({ outcome: { outcome: "selected", optionId: "once" } })
    })
    let active = 0
    let maxActive = 0
    const harness = createHarness({
      sessionGet: async (sessionID) => {
        if (sessionID !== "ses_leaf_a" && sessionID !== "ses_leaf_b") {
          throw new Error(`unexpected session lookup: ${sessionID}`)
        }
        return { parentID: "ses_root" }
      },
      requestPermission: async () => {
        active += 1
        maxActive = Math.max(maxActive, active)
        try {
          if (harness.requests.length === 1) return await first
          return { outcome: { outcome: "selected", optionId: "once" } }
        } finally {
          active -= 1
        }
      },
    })
    await createSession(harness.session, "ses_root")

    harness.subscription.handle(permissionAsked("ses_leaf_a", "perm_leaf_a"))
    harness.subscription.handle(permissionAsked("ses_leaf_b", "perm_leaf_b"))

    await pollUntil(() => harness.requests.length === 1, "first sibling permission was never requested")
    expect(harness.requests[0]?.sessionId).toBe("ses_root")
    releaseFirst?.()
    await pollUntil(() => harness.replies.length === 2, "sibling permissions were not both replied")

    expect(harness.requests).toHaveLength(2)
    expect(harness.requests.every((request) => request.sessionId === "ses_root")).toBe(true)
    expect(maxActive).toBe(1)
  })
})
