import { describe, expect, it } from "bun:test"
import type { AgentSideConnection } from "@agentclientprotocol/sdk"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import type { Event, OpencodeClient, SessionMessageResponse, ToolPart } from "@opencode-ai/sdk/v2"
import { Effect, ManagedRuntime } from "effect"
import { ACPEvent } from "@/acp/event"
import { ACPSession } from "@/acp/session"

type SessionUpdateParams = Parameters<AgentSideConnection["sessionUpdate"]>[0]
type GlobalEventEnvelope = { payload?: Event }

function makeSessionService() {
  return ManagedRuntime.make(LayerNode.compile(ACPSession.node)).runSync(
    ACPSession.Service.use((service) => Effect.succeed(service)),
  )
}

function createEventStream() {
  const queue: GlobalEventEnvelope[] = []
  const waiters: Array<(value: GlobalEventEnvelope | undefined) => void> = []
  const state = { closed: false }

  const push = (event: GlobalEventEnvelope) => {
    const waiter = waiters.shift()
    if (waiter) {
      waiter(event)
      return
    }
    queue.push(event)
  }

  const close = () => {
    state.closed = true
    for (const waiter of waiters.splice(0)) {
      waiter(undefined)
    }
  }

  const stream = async function* (signal?: AbortSignal) {
    while (true) {
      if (signal?.aborted) return
      const next = queue.shift()
      if (next) {
        yield next
        continue
      }
      if (state.closed) return
      const value = await new Promise<GlobalEventEnvelope | undefined>((resolve) => {
        waiters.push(resolve)
        signal?.addEventListener("abort", () => resolve(undefined), { once: true })
      })
      if (!value) return
      yield value
    }
  }

  return { push, close, stream }
}

function createHarness(messages: Record<string, SessionMessageResponse> = {}, options: { v2?: boolean } = {}) {
  const updates: SessionUpdateParams[] = []
  const events = createEventStream()
  const sdk = {
    global: {
      event: (opts?: { signal?: AbortSignal }) => Promise.resolve({ stream: events.stream(opts?.signal) }),
    },
    session: {
      message: (input: { messageID: string }) => Promise.resolve({ data: messages[input.messageID] }),
      get: () => Promise.resolve({ data: { id: "ses_loaded" } }),
      messages: () => Promise.resolve({ data: [] }),
    },
  } as unknown as OpencodeClient
  const connection = {
    sessionUpdate: (params: SessionUpdateParams) => {
      updates.push(params)
      return Promise.resolve()
    },
  } satisfies Pick<AgentSideConnection, "sessionUpdate">
  const session = makeSessionService()
  const subscription = new ACPEvent.Subscription({
    sdk,
    connection,
    session,
    ...(options.v2 ? { isV2: () => true } : {}),
  })

  return { connection, events, sdk, session, subscription, updates }
}

function toolUpdated(part: ToolPart): Event {
  return {
    id: `evt_${part.sessionID}_${part.messageID}_${part.id}_${part.state.status}`,
    type: "message.part.updated",
    properties: {
      sessionID: part.sessionID,
      time: Date.now(),
      part,
    },
  }
}

function runningTool(
  sessionID: string,
  callID: string,
  output?: string,
  input: Record<string, unknown> = { cmd: "printf hello" },
) {
  return {
    id: `part_${callID}`,
    sessionID,
    messageID: `msg_${callID}`,
    type: "tool",
    callID,
    tool: "bash",
    state: {
      status: "running",
      input,
      title: "bash",
      ...(output !== undefined ? { metadata: { output } } : {}),
      time: { start: Date.now() },
    },
  } satisfies ToolPart
}

function completedEditTool(sessionID: string, callID: string, filePath: string, oldText: string, newText: string) {
  return {
    id: `part_${callID}`,
    sessionID,
    messageID: `msg_${callID}`,
    type: "tool",
    callID,
    tool: "edit",
    state: {
      status: "completed",
      input: { filePath, oldString: oldText, newString: newText },
      output: "edited",
      title: "edit",
      metadata: {},
      time: { start: Date.now() - 1, end: Date.now() },
    },
  } satisfies ToolPart
}

function completedBashTool(sessionID: string, callID: string, output = "done") {
  return {
    id: `part_${callID}`,
    sessionID,
    messageID: `msg_${callID}`,
    type: "tool",
    callID,
    tool: "bash",
    state: {
      status: "completed",
      input: { cmd: "echo done" },
      output,
      title: "bash",
      metadata: { exit: 0 },
      time: { start: Date.now() - 1, end: Date.now() },
    },
  } satisfies ToolPart
}

const updateName = (u: SessionUpdateParams) => (u.update as unknown as { sessionUpdate: string }).sessionUpdate

describe("acp v2 event routing", () => {
  it("emits tool_call_update (not tool_call) for creation in v2 mode", async () => {
    const harness = createHarness({}, { v2: true })
    await Effect.runPromise(harness.session.create({ id: "ses_v2_tool", cwd: "/workspace" }))

    await harness.subscription.handle(toolUpdated(runningTool("ses_v2_tool", "call_v2_1")))

    const toolUpdates = harness.updates.filter(
      (u) => updateName(u) === "tool_call" || updateName(u) === "tool_call_update",
    )
    expect(toolUpdates.every((u) => updateName(u) === "tool_call_update")).toBe(true)
    expect(toolUpdates.some((u) => updateName(u) === "tool_call")).toBe(false)
  })

  it("converts v1 diff content to v2 structured diff with changes and git_patch", async () => {
    const harness = createHarness({}, { v2: true })
    await Effect.runPromise(harness.session.create({ id: "ses_v2_diff", cwd: "/workspace" }))

    await harness.subscription.handle(
      toolUpdated(completedEditTool("ses_v2_diff", "call_diff", "/workspace/file.ts", "old line", "new line")),
    )

    const completedUpdate = harness.updates.find(
      (u) => updateName(u) === "tool_call_update" && "status" in u.update && u.update.status === "completed",
    )
    expect(completedUpdate).toBeDefined()

    const content = (completedUpdate!.update as { content?: Array<Record<string, unknown>> }).content
    const diffContent = content?.find((c) => c.type === "diff")
    expect(diffContent).toBeDefined()
    expect(diffContent!.changes).toBeDefined()
    expect((diffContent!.changes as unknown[])[0]).toMatchObject({
      operation: "modify",
      path: "/workspace/file.ts",
      fileType: "text",
    })
    expect(diffContent!.patch).toBeDefined()
    expect((diffContent!.patch as { format: string }).format).toBe("git_patch")
    expect((diffContent!.patch as { text: string }).text).toContain("diff --git")
    expect((diffContent!.patch as { text: string }).text).toContain("-old line")
    expect((diffContent!.patch as { text: string }).text).toContain("+new line")
  })

  it("emits terminal_update for bash tools in v2 mode", async () => {
    const harness = createHarness({}, { v2: true })
    await Effect.runPromise(harness.session.create({ id: "ses_v2_term", cwd: "/workspace" }))

    await harness.subscription.handle(toolUpdated(runningTool("ses_v2_term", "call_term", "hello output")))

    const terminalUpdates = harness.updates.filter((u) => updateName(u) === "terminal_update")
    expect(terminalUpdates).toHaveLength(1)
    expect(terminalUpdates[0].update).toMatchObject({
      terminalId: "call_term",
      command: "printf hello",
      cwd: "/workspace",
    })
    const output = (terminalUpdates[0].update as { output?: { data: string } }).output
    expect(output).toBeDefined()
    expect(Buffer.from(output!.data, "base64").toString()).toBe("hello output")
  })

  it("emits terminal_update with exitStatus on completed bash tools in v2 mode", async () => {
    const harness = createHarness({}, { v2: true })
    await Effect.runPromise(harness.session.create({ id: "ses_v2_term_done", cwd: "/workspace" }))

    await harness.subscription.handle(toolUpdated(completedBashTool("ses_v2_term_done", "call_term_done", "all done")))

    const terminalUpdates = harness.updates.filter((u) => updateName(u) === "terminal_update")
    expect(terminalUpdates).toHaveLength(1)
    expect(terminalUpdates[0].update).toMatchObject({
      terminalId: "call_term_done",
      command: "echo done",
    })
    const exitStatus = (terminalUpdates[0].update as { exitStatus?: { exitCode?: number } }).exitStatus
    expect(exitStatus).toBeDefined()
    expect(exitStatus!.exitCode).toBe(0)
  })

  it("emits plan_update (not plan) for todo.updated events in v2 mode", async () => {
    const harness = createHarness({}, { v2: true })
    await Effect.runPromise(harness.session.create({ id: "ses_v2_plan", cwd: "/workspace" }))

    await harness.subscription.handle({
      id: "evt_todo",
      type: "todo.updated",
      properties: {
        sessionID: "ses_v2_plan",
        todos: [
          { content: "Task 1", status: "in_progress", priority: "high" },
          { content: "Task 2", status: "pending", priority: "low" },
        ],
      },
    } as unknown as Event)

    const planUpdates = harness.updates.filter((u) => updateName(u) === "plan_update")
    expect(planUpdates).toHaveLength(1)
    const plan = (planUpdates[0].update as { plan: { type: string; planId: string; entries: unknown[] } }).plan
    expect(plan.type).toBe("items")
    expect(plan.planId).toBe("default")
    expect(plan.entries).toHaveLength(2)

    const v1PlanUpdates = harness.updates.filter((u) => updateName(u) === "plan")
    expect(v1PlanUpdates).toHaveLength(0)
  })

  it("does not emit terminal_update for non-shell tools in v2 mode", async () => {
    const harness = createHarness({}, { v2: true })
    await Effect.runPromise(harness.session.create({ id: "ses_v2_no_term", cwd: "/workspace" }))

    const editPart: ToolPart = {
      id: "part_edit",
      sessionID: "ses_v2_no_term",
      messageID: "msg_edit",
      type: "tool",
      callID: "call_edit",
      tool: "edit",
      state: {
        status: "running",
        input: { filePath: "/workspace/file.ts" },
        title: "Edit file",
        time: { start: Date.now() },
      },
    }

    await harness.subscription.handle(toolUpdated(editPart))

    const terminalUpdates = harness.updates.filter((u) => updateName(u) === "terminal_update")
    expect(terminalUpdates).toHaveLength(0)
  })
})

describe("acp v2 content blocks and extensibility", () => {
  it("preserves _meta on resource_link content chunks output", async () => {
    const { partToContentChunks } = await import("@/acp/content")
    const chunks = partToContentChunks({
      type: "file",
      url: "file:///workspace/file.ts",
      mime: "text/typescript",
      filename: "file.ts",
      _meta: { custom: "data" },
    })
    expect(chunks).toHaveLength(1)
    expect(chunks[0]._meta).toEqual({ custom: "data" })
  })

  it("preserves _meta on text content chunks output", async () => {
    const { partToContentChunks } = await import("@/acp/content")
    const chunks = partToContentChunks({
      type: "text",
      text: "hello",
      _meta: { source: "test" },
    })
    expect(chunks).toHaveLength(1)
    expect(chunks[0]._meta).toEqual({ source: "test" })
  })

  it("renders unknown content block types as text fallback when _meta is present", async () => {
    const { contentBlockToParts } = await import("@/acp/content")
    const parts = contentBlockToParts({
      type: "_custom_block",
      data: "custom data",
      _meta: { extension: "mycompany" },
    } as unknown as import("@agentclientprotocol/sdk").ContentBlock)
    expect(parts).toHaveLength(1)
    expect(parts[0].type).toBe("text")
    expect((parts[0] as { text?: string }).text).toContain("_custom_block")
  })

  it("drops unknown content block types without _meta silently", async () => {
    const { contentBlockToParts } = await import("@/acp/content")
    const parts = contentBlockToParts({
      type: "_custom_block",
      data: "custom data",
    } as unknown as import("@agentclientprotocol/sdk").ContentBlock)
    expect(parts).toHaveLength(0)
  })

  it("preserves _meta from incoming resource_link as metadata on text parts", async () => {
    const { contentBlockToParts } = await import("@/acp/content")
    const parts = contentBlockToParts({
      type: "resource_link",
      uri: "https://example.com/doc",
      name: "doc",
      _meta: { origin: "client" },
    } as unknown as import("@agentclientprotocol/sdk").ContentBlock)
    expect(parts).toHaveLength(1)
    expect(parts[0].type).toBe("text")
    // _meta should be preserved in the metadata field of the text part
    expect((parts[0] as { metadata?: { _meta?: unknown } }).metadata?._meta).toEqual({ origin: "client" })
  })
})
