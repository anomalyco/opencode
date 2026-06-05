import { describe, expect, it } from "bun:test"
import type { AgentSideConnection } from "@agentclientprotocol/sdk"
import type { Event, Message, OpencodeClient, Part, SessionMessageResponse, ToolPart } from "@opencode-ai/sdk/v2"
import { Effect, ManagedRuntime } from "effect"
import { ACPEvent } from "@/acp/event"
import * as ACPService from "@/acp/service"
import { Directory } from "@/acp/directory"
import { ACPSession } from "@/acp/session"
import { ACPTerminal } from "@/acp/terminal"

type SessionUpdateParams = Parameters<AgentSideConnection["sessionUpdate"]>[0]
type ToolSessionUpdateParams = SessionUpdateParams & {
  update: Extract<SessionUpdateParams["update"], { sessionUpdate: "tool_call" | "tool_call_update" }>
}
type GlobalEventEnvelope = {
  payload?: Event
}
type DeltaPartType = Extract<Part, { type: "text" | "reasoning" }>["type"]

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

function createHarness(
  messages: Record<string, SessionMessageResponse> = {},
  options: {
    sessionUpdate?: (params: SessionUpdateParams) => Promise<void>
    terminal?: ACPTerminal.Interface
  } = {},
) {
  const updates: SessionUpdateParams[] = []
  const calls = {
    eventSubscribe: 0,
    message: 0,
  }
  const events = createEventStream()
  const sdk = {
    global: {
      event: (options?: { signal?: AbortSignal }) => {
        calls.eventSubscribe++
        return Promise.resolve({ stream: events.stream(options?.signal) })
      },
    },
    session: {
      message: (input: { messageID: string }) => {
        calls.message++
        return Promise.resolve({ data: messages[input.messageID] })
      },
      get: () => Promise.resolve({ data: { id: "ses_loaded" } }),
      messages: () => Promise.resolve({ data: [] }),
    },
  } as unknown as OpencodeClient
  const connection = {
    sessionUpdate: (params: SessionUpdateParams) => {
      updates.push(params)
      return options.sessionUpdate?.(params) ?? Promise.resolve()
    },
  } satisfies Pick<AgentSideConnection, "sessionUpdate">
  const session = makeSessionService()
  const terminal = options.terminal ?? ACPTerminal.make({})
  const subscription = new ACPEvent.Subscription({ sdk, connection, session, terminal })

  return { calls, connection, events, sdk, session, subscription, terminal, updates }
}

function textDelta(sessionID: string, messageID: string, partID: string, delta: string): Event {
  return {
    id: `evt_${sessionID}_${messageID}_${partID}_${delta}`,
    type: "message.part.delta",
    properties: {
      sessionID,
      messageID,
      partID,
      field: "text",
      delta,
    },
  }
}

function partUpdated(sessionID: string, messageID: string, partID: string, type: DeltaPartType): Event {
  return {
    id: `evt_${sessionID}_${messageID}_${partID}`,
    type: "message.part.updated",
    properties: {
      sessionID,
      time: Date.now(),
      part:
        type === "text"
          ? {
              id: partID,
              sessionID,
              messageID,
              type: "text",
              text: "",
            }
          : {
              id: partID,
              sessionID,
              messageID,
              type: "reasoning",
              text: "",
              time: { start: Date.now() },
            },
    },
  }
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

function shellStarted(sessionID: string, callID: string, command: string): Event {
  return {
    id: `evt_${sessionID}_${callID}_shell_started`,
    type: "session.next.shell.started",
    properties: {
      timestamp: Date.now(),
      sessionID,
      messageID: `msg_${callID}`,
      callID,
      command,
    },
  }
}

function shellEnded(sessionID: string, callID: string, output: string): Event {
  return {
    id: `evt_${sessionID}_${callID}_shell_ended`,
    type: "session.next.shell.ended",
    properties: {
      timestamp: Date.now(),
      sessionID,
      callID,
      output,
    },
  }
}

function assistantMessage(sessionID: string, messageID: string, partID: string, type: DeltaPartType) {
  return {
    info: {
      id: messageID,
      sessionID,
      role: "assistant",
      time: { created: Date.now() },
      parentID: "msg_parent",
      modelID: "model",
      providerID: "provider",
      mode: "build",
      agent: "build",
      path: { cwd: "/workspace", root: "/workspace" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts: [
      type === "text"
        ? {
            id: partID,
            sessionID,
            messageID,
            type: "text",
            text: "",
          }
        : {
            id: partID,
            sessionID,
            messageID,
            type: "reasoning",
            text: "",
            time: { start: Date.now() },
          },
    ],
  } satisfies SessionMessageResponse
}

function assistantToolMessage(part: ToolPart) {
  return {
    info: {
      id: part.messageID,
      sessionID: part.sessionID,
      role: "assistant",
      time: { created: Date.now() },
      parentID: "msg_parent",
      modelID: "model",
      providerID: "provider",
      mode: "build",
      agent: "build",
      path: { cwd: "/workspace", root: "/workspace" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts: [part],
  } satisfies SessionMessageResponse
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

function completedTool(
  sessionID: string,
  callID: string,
  output = "done",
  attachments: Extract<ToolPart["state"], { status: "completed" }>["attachments"] = [],
  options: {
    readonly tool?: string
    readonly input?: Record<string, unknown>
    readonly metadata?: Record<string, unknown>
  } = {},
) {
  return {
    id: `part_${callID}`,
    sessionID,
    messageID: `msg_${callID}`,
    type: "tool",
    callID,
    tool: options.tool ?? "bash",
    state: {
      status: "completed",
      input: options.input ?? { cmd: "printf done" },
      output,
      title: "bash",
      metadata: options.metadata ?? { exit: 0 },
      time: { start: Date.now() - 1, end: Date.now() },
      ...(attachments.length ? { attachments } : {}),
    },
  } satisfies ToolPart
}

function errorTool(sessionID: string, callID: string) {
  return {
    id: `part_${callID}`,
    sessionID,
    messageID: `msg_${callID}`,
    type: "tool",
    callID,
    tool: "bash",
    state: {
      status: "error",
      input: { cmd: "exit 1" },
      error: "failed hard",
      metadata: { exit: 1 },
      time: { start: Date.now() - 1, end: Date.now() },
    },
  } satisfies ToolPart
}

function toolUpdates(updates: SessionUpdateParams[]) {
  return updates.filter((item): item is ToolSessionUpdateParams => {
    return item.update.sessionUpdate === "tool_call" || item.update.sessionUpdate === "tool_call_update"
  })
}

async function createKnownSession(
  session: ACPSession.Interface,
  sessionId: string,
  part: { messageId: string; partId: string; partType: Part["type"]; role?: Message["role"] },
) {
  await Effect.runPromise(session.create({ id: sessionId, cwd: "/workspace" }))
  await Effect.runPromise(
    session.recordPartMetadata({
      sessionId,
      messageId: part.messageId,
      partId: part.partId,
      partType: part.partType,
      role: part.role ?? "assistant",
    }),
  )
}

describe("acp event routing", () => {
  it("routes message.part.delta by sessionID without cross-session pollution", async () => {
    const harness = createHarness()
    await createKnownSession(harness.session, "ses_a", { messageId: "msg_a", partId: "part_a", partType: "text" })
    await createKnownSession(harness.session, "ses_b", { messageId: "msg_b", partId: "part_b", partType: "text" })

    await harness.subscription.handle(textDelta("ses_b", "msg_b", "part_b", "hello"))

    expect(harness.updates.map((update) => update.sessionId)).toEqual(["ses_b"])
    expect(harness.updates[0]?.update.sessionUpdate).toBe("agent_message_chunk")
  })

  it("keeps interleaved sessions isolated for text and reasoning deltas", async () => {
    const harness = createHarness()
    await createKnownSession(harness.session, "ses_a", { messageId: "msg_a", partId: "part_a", partType: "text" })
    await createKnownSession(harness.session, "ses_b", {
      messageId: "msg_b",
      partId: "part_b",
      partType: "reasoning",
    })

    await harness.subscription.handle(textDelta("ses_a", "msg_a", "part_a", "A1"))
    await harness.subscription.handle(textDelta("ses_b", "msg_b", "part_b", "B1"))
    await harness.subscription.handle(textDelta("ses_a", "msg_a", "part_a", "A2"))
    await harness.subscription.handle(textDelta("ses_b", "msg_b", "part_b", "B2"))

    expect(
      harness.updates.filter((update) => update.sessionId === "ses_a").map((update) => update.update.sessionUpdate),
    ).toEqual(["agent_message_chunk", "agent_message_chunk"])
    expect(
      harness.updates.filter((update) => update.sessionId === "ses_b").map((update) => update.update.sessionUpdate),
    ).toEqual(["agent_thought_chunk", "agent_thought_chunk"])
  })

  it("does not create extra subscriptions on repeated loadSession", async () => {
    const harness = createHarness()
    let subscription: ACPEvent.Subscription | undefined
    const service = ACPService.make({
      sdk: harness.sdk,
      connection: harness.connection,
      directory: {
        get: () =>
          Effect.succeed(
            Directory.build({
              directory: "/workspace",
              providers: {},
              modes: [],
              defaultModeID: "build",
              commands: [],
            }),
          ),
        refresh: () =>
          Effect.succeed(
            Directory.build({
              directory: "/workspace",
              providers: {},
              modes: [],
              defaultModeID: "build",
              commands: [],
            }),
          ),
        variants: Directory.variants,
      },
      session: harness.session,
      eventSubscription: (started) => {
        subscription = started
      },
    })

    await pollUntil(() => harness.calls.eventSubscribe === 1, "event subscription did not start")
    await Effect.runPromise(service.loadSession({ cwd: "/workspace", sessionId: "ses_loaded", mcpServers: [] }))
    await Effect.runPromise(service.loadSession({ cwd: "/workspace", sessionId: "ses_loaded", mcpServers: [] }))
    await Effect.runPromise(service.loadSession({ cwd: "/workspace", sessionId: "ses_loaded", mcpServers: [] }))

    expect(harness.calls.eventSubscribe).toBe(1)
    subscription?.stop()
    harness.events.close()
  })

  it("does not call sdk.session.message repeatedly when metadata is known", async () => {
    const harness = createHarness()
    await createKnownSession(harness.session, "ses_a", { messageId: "msg_a", partId: "part_a", partType: "text" })

    for (const delta of ["a", "b", "c", "d", "e"]) {
      await harness.subscription.handle(textDelta("ses_a", "msg_a", "part_a", delta))
    }

    expect(harness.calls.message).toBe(0)
    expect(harness.updates).toHaveLength(5)
  })

  it("fetches unknown part metadata once and reuses it for later deltas", async () => {
    const harness = createHarness({
      msg_a: assistantMessage("ses_a", "msg_a", "part_a", "text"),
    })
    await Effect.runPromise(harness.session.create({ id: "ses_a", cwd: "/workspace" }))

    await harness.subscription.handle(partUpdated("ses_a", "msg_a", "part_a", "text"))
    await harness.subscription.handle(textDelta("ses_a", "msg_a", "part_a", "a"))
    await harness.subscription.handle(textDelta("ses_a", "msg_a", "part_a", "b"))

    expect(harness.calls.message).toBe(1)
    expect(harness.updates).toHaveLength(2)
  })

  it("replays loaded session messages sequentially and continues after update failures", async () => {
    const events = createEventStream()
    const updates: SessionUpdateParams[] = []
    const connection = {
      sessionUpdate: (params: SessionUpdateParams) => {
        if (params.update.sessionUpdate === "tool_call" && params.update.toolCallId === "call_slow") {
          return new Promise<void>((resolve) => {
            setTimeout(() => {
              updates.push(params)
              resolve()
            }, 20)
          })
        }

        if (params.update.sessionUpdate === "tool_call_update" && params.update.toolCallId === "call_slow") {
          return Promise.reject(new Error("replay send failed"))
        }

        updates.push(params)
        return Promise.resolve()
      },
    } satisfies Pick<AgentSideConnection, "sessionUpdate">
    let subscription: ACPEvent.Subscription | undefined
    const service = ACPService.make({
      sdk: {
        global: {
          event: (options?: { signal?: AbortSignal }) => Promise.resolve({ stream: events.stream(options?.signal) }),
        },
        session: {
          get: () => Promise.resolve({ data: { id: "ses_loaded" } }),
          messages: () =>
            Promise.resolve({
              data: [
                assistantToolMessage(completedTool("ses_loaded", "call_slow", "slow")),
                assistantToolMessage(completedTool("ses_loaded", "call_after", "after")),
              ],
            }),
        },
      } as unknown as OpencodeClient,
      connection,
      directory: {
        get: () =>
          Effect.succeed(
            Directory.build({
              directory: "/workspace",
              providers: {},
              modes: [],
              defaultModeID: "build",
              commands: [],
            }),
          ),
        refresh: () =>
          Effect.succeed(
            Directory.build({
              directory: "/workspace",
              providers: {},
              modes: [],
              defaultModeID: "build",
              commands: [],
            }),
          ),
        variants: Directory.variants,
      },
      eventSubscription: (started) => {
        subscription = started
      },
    })

    await Effect.runPromise(service.loadSession({ cwd: "/workspace", sessionId: "ses_loaded", mcpServers: [] }))

    expect(toolUpdates(updates).map((item) => item.update.toolCallId)).toEqual([
      "call_slow",
      "call_after",
      "call_after",
    ])
    subscription?.stop()
    events.close()
  })

  it("ignores unknown sessions and live user parts without user_message_chunk duplication", async () => {
    const harness = createHarness()
    await createKnownSession(harness.session, "ses_user", {
      messageId: "msg_user",
      partId: "part_user",
      partType: "text",
      role: "user",
    })

    await harness.subscription.handle(textDelta("ses_missing", "msg_missing", "part_missing", "ignored"))
    await harness.subscription.handle(partUpdated("ses_user", "msg_user", "part_live", "text"))
    await harness.subscription.handle(textDelta("ses_user", "msg_user", "part_user", "hello"))

    expect(harness.updates).toHaveLength(0)
  })

  it("emits synthetic pending before the first running tool update", async () => {
    const harness = createHarness()
    await Effect.runPromise(harness.session.create({ id: "ses_tool", cwd: "/workspace" }))

    await harness.subscription.handle(toolUpdated(runningTool("ses_tool", "call_1", "hello")))

    expect(toolUpdates(harness.updates).map((item) => item.update.sessionUpdate)).toEqual([
      "tool_call",
      "tool_call_update",
    ])
    expect(harness.updates[0]?.update).toMatchObject({ status: "pending", toolCallId: "call_1" })
    expect(harness.updates[1]?.update).toMatchObject({ status: "in_progress", toolCallId: "call_1" })
  })

  it("does not emit duplicate synthetic pending after a replayed running tool", async () => {
    const harness = createHarness()
    await Effect.runPromise(harness.session.create({ id: "ses_replay", cwd: "/workspace" }))

    await harness.subscription.replayMessage(assistantToolMessage(runningTool("ses_replay", "call_replay", "first")))
    await harness.subscription.handle(toolUpdated(runningTool("ses_replay", "call_replay", "second")))

    expect(toolUpdates(harness.updates).filter((item) => item.update.sessionUpdate === "tool_call")).toHaveLength(1)
    expect(toolUpdates(harness.updates).map((item) => item.update.sessionUpdate)).toEqual([
      "tool_call",
      "tool_call_update",
      "tool_call_update",
    ])
  })

  it("replays completed shell output through Zed terminal metadata", async () => {
    const harness = createHarness()
    await Effect.runPromise(harness.session.create({ id: "ses_shell_replay", cwd: "/workspace" }))

    await harness.subscription.replayMessage(
      assistantToolMessage(
        completedTool("ses_shell_replay", "call_shell_replay", "replayed output", [], {
          input: { command: "printf replayed" },
          metadata: { exit: 0 },
        }),
      ),
    )

    const updates = toolUpdates(harness.updates)
    expect(updates).toHaveLength(2)
    expect(updates[0]?.update).toMatchObject({
      sessionUpdate: "tool_call",
      toolCallId: "call_shell_replay",
      title: "printf replayed",
      _meta: {
        terminal_info: {
          terminal_id:
            "opencode_replay_ses_shell_replay_msg_call_shell_replay_part_call_shell_replay_call_shell_replay",
          cwd: "/workspace",
        },
      },
    })
    expect(updates[1]?.update).toMatchObject({
      sessionUpdate: "tool_call_update",
      toolCallId: "call_shell_replay",
      status: "completed",
      content: [
        {
          type: "terminal",
          terminalId: "opencode_replay_ses_shell_replay_msg_call_shell_replay_part_call_shell_replay_call_shell_replay",
        },
      ],
      _meta: {
        terminal_output: {
          terminal_id:
            "opencode_replay_ses_shell_replay_msg_call_shell_replay_part_call_shell_replay_call_shell_replay",
          data: "replayed output",
        },
        terminal_exit: {
          terminal_id:
            "opencode_replay_ses_shell_replay_msg_call_shell_replay_part_call_shell_replay_call_shell_replay",
          exit_code: 0,
        },
      },
    })
  })

  it("dedupes shell output snapshots while still sending status-only running updates", async () => {
    const harness = createHarness()
    await Effect.runPromise(harness.session.create({ id: "ses_shell", cwd: "/workspace" }))

    await harness.subscription.handle(toolUpdated(runningTool("ses_shell", "call_shell", "same")))
    await harness.subscription.handle(toolUpdated(runningTool("ses_shell", "call_shell", "same")))

    const updates = toolUpdates(harness.updates)
    expect(updates).toHaveLength(3)
    expect(updates[1]?.update).toMatchObject({
      sessionUpdate: "tool_call_update",
      content: [{ type: "content", content: { type: "text", text: "same" } }],
    })
    expect(updates[2]?.update).toMatchObject({ sessionUpdate: "tool_call_update", status: "in_progress" })
    expect("content" in updates[2]!.update).toBe(false)
  })

  it("clears shell snapshot marker when a tool returns to pending", async () => {
    const harness = createHarness()
    await Effect.runPromise(harness.session.create({ id: "ses_pending", cwd: "/workspace" }))

    await harness.subscription.handle(toolUpdated(runningTool("ses_pending", "call_pending", "repeat")))
    await harness.subscription.handle(
      toolUpdated({
        id: "part_call_pending",
        sessionID: "ses_pending",
        messageID: "msg_call_pending",
        type: "tool",
        callID: "call_pending",
        tool: "bash",
        state: {
          status: "pending",
          input: { cmd: "printf repeat" },
          raw: '{"cmd":"printf repeat"}',
        },
      }),
    )
    await harness.subscription.handle(toolUpdated(runningTool("ses_pending", "call_pending", "repeat")))

    expect(
      toolUpdates(harness.updates)
        .filter((item) => item.update.sessionUpdate === "tool_call_update")
        .map((item) => ("content" in item.update ? item.update.content : undefined)),
    ).toEqual([
      [{ type: "content", content: { type: "text", text: "repeat" } }],
      [{ type: "content", content: { type: "text", text: "repeat" } }],
    ])
  })

  it("emits completed tool output and rawOutput", async () => {
    const harness = createHarness()
    await Effect.runPromise(harness.session.create({ id: "ses_done", cwd: "/workspace" }))

    await harness.subscription.handle(toolUpdated(completedTool("ses_done", "call_done", "finished")))

    expect(harness.updates.at(-1)?.update).toMatchObject({
      sessionUpdate: "tool_call_update",
      toolCallId: "call_done",
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: "finished" } }],
      rawOutput: { output: "finished", metadata: { exit: 0 } },
    })
  })

  it("releases terminal metadata even when final completed update fails", async () => {
    let releases = 0
    const terminal = {
      id: "term_release_on_failure",
      currentOutput: async () => ({ output: "done", truncated: false }),
      waitForExit: async () => ({ exitCode: 0 }),
      kill: async () => undefined,
      release: async () => {
        releases += 1
      },
      [Symbol.asyncDispose]: async () => undefined,
    } as unknown as Awaited<ReturnType<AgentSideConnection["createTerminal"]>>
    const terminalService = ACPTerminal.make({
      connection: {
        createTerminal: async () => terminal,
      } as unknown as Pick<AgentSideConnection, "createTerminal">,
    })
    const harness = createHarness(
      {},
      {
        terminal: terminalService,
        sessionUpdate: (params) => {
          if (params.update.sessionUpdate === "tool_call_update" && params.update.status === "completed") {
            return Promise.reject(new Error("update failed"))
          }
          return Promise.resolve()
        },
      },
    )
    await Effect.runPromise(harness.session.create({ id: "ses_release", cwd: "/workspace" }))

    terminalService.configure({ enabled: true })
    terminalService.register("ses_release")
    try {
      await terminalService.run({
        sessionId: "ses_release",
        command: "bash",
        args: ["-c", "echo done"],
        cwd: "/workspace",
        env: {},
        timeout: 1000,
        outputByteLimit: 1024,
        signal: new AbortController().signal,
        onStart: async () => undefined,
      })

      await harness.subscription.handle(toolUpdated(runningTool("ses_release", "call_release", "")))
      await expect(
        harness.subscription.handle(
          toolUpdated(
            completedTool("ses_release", "call_release", "done", [], {
              metadata: { terminalId: "term_release_on_failure" },
            }),
          ),
        ),
      ).rejects.toThrow("update failed")
      expect(releases).toBe(1)
    } finally {
      terminalService.unregister("ses_release")
    }
  })

  it("emits shell event output and raw payloads", async () => {
    const harness = createHarness()
    await Effect.runPromise(harness.session.create({ id: "ses_shell_events", cwd: "/workspace" }))

    await harness.subscription.handle(shellStarted("ses_shell_events", "call_shell_event", "printf hello"))
    await harness.subscription.handle(shellEnded("ses_shell_events", "call_shell_event", "hello"))

    expect(toolUpdates(harness.updates).map((item) => item.update.sessionUpdate)).toEqual([
      "tool_call",
      "tool_call_update",
      "tool_call_update",
    ])
    expect(harness.updates[0]?.update).toMatchObject({
      sessionUpdate: "tool_call",
      toolCallId: "call_shell_event",
      title: "printf hello",
      rawInput: { command: "printf hello" },
    })
    expect(harness.updates.at(-1)?.update).toMatchObject({
      sessionUpdate: "tool_call_update",
      toolCallId: "call_shell_event",
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: "hello" } }],
      rawInput: { command: "printf hello" },
      rawOutput: { output: "hello" },
    })
  })

  it("emits shell ended output even if the start event was missed", async () => {
    const harness = createHarness()
    await Effect.runPromise(harness.session.create({ id: "ses_shell_end", cwd: "/workspace" }))

    await harness.subscription.handle(shellEnded("ses_shell_end", "call_shell_end", "late output"))

    expect(harness.updates.at(-1)?.update).toMatchObject({
      sessionUpdate: "tool_call_update",
      toolCallId: "call_shell_end",
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: "late output" } }],
      rawInput: {},
      rawOutput: { output: "late output" },
    })
  })

  it("emits clean read display content and preserves rawOutput", async () => {
    const harness = createHarness()
    await Effect.runPromise(harness.session.create({ id: "ses_read", cwd: "/workspace" }))
    const output = [
      "<path>/workspace/file.ts</path>",
      "<type>file</type>",
      "<content>",
      "1: import { value } from './value'",
      "2: export { value }",
      "",
      "(End of file - total 2 lines)",
      "</content>",
    ].join("\n")
    const metadata = {
      display: {
        type: "file",
        path: "/workspace/file.ts",
        text: "import { value } from './value'\nexport { value }",
        lineStart: 1,
        lineEnd: 2,
        totalLines: 2,
        truncated: false,
      },
    }

    await harness.subscription.handle(
      toolUpdated(
        completedTool("ses_read", "call_read", output, [], {
          tool: "read",
          input: { filePath: "/workspace/file.ts" },
          metadata,
        }),
      ),
    )

    expect(harness.updates.at(-1)?.update).toMatchObject({
      sessionUpdate: "tool_call_update",
      toolCallId: "call_read",
      status: "completed",
      content: [
        {
          type: "content",
          content: { type: "text", text: "import { value } from './value'\nexport { value }" },
        },
      ],
      rawOutput: { output, metadata },
    })
  })

  it("emits error tool output", async () => {
    const harness = createHarness()
    await Effect.runPromise(harness.session.create({ id: "ses_error", cwd: "/workspace" }))

    await harness.subscription.handle(toolUpdated(errorTool("ses_error", "call_error")))

    expect(harness.updates.at(-1)?.update).toMatchObject({
      sessionUpdate: "tool_call_update",
      toolCallId: "call_error",
      status: "failed",
      content: [{ type: "content", content: { type: "text", text: "failed hard" } }],
      rawOutput: { error: "failed hard", metadata: { exit: 1 } },
    })
  })

  it("emits image attachments as ACP image content for live and replayed completed tool updates", async () => {
    const harness = createHarness()
    const image = Buffer.from("image-data").toString("base64")
    const attachment = {
      id: "file_image",
      sessionID: "ses_image",
      messageID: "msg_image",
      type: "file",
      mime: "image/png",
      filename: "image.png",
      url: `data:image/png;base64,${image}`,
    } as const
    await Effect.runPromise(harness.session.create({ id: "ses_image", cwd: "/workspace" }))

    await harness.subscription.handle(toolUpdated(completedTool("ses_image", "call_live", "live", [attachment])))
    await harness.subscription.replayMessage(
      assistantToolMessage(completedTool("ses_image", "call_replayed", "replayed", [attachment])),
    )

    expect(
      toolUpdates(harness.updates)
        .filter((item) => item.update.sessionUpdate === "tool_call_update" && item.update.status === "completed")
        .map((item) => ("content" in item.update ? item.update.content : [])),
    ).toEqual([
      [
        { type: "content", content: { type: "text", text: "live" } },
        { type: "content", content: { type: "image", mimeType: "image/png", data: image } },
      ],
      [
        { type: "content", content: { type: "text", text: "replayed" } },
        { type: "content", content: { type: "image", mimeType: "image/png", data: image } },
      ],
    ])
  })
})
