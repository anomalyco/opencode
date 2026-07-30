import { describe, expect, it } from "bun:test"
import type {
  AgentSideConnection,
  ForkSessionResponse,
  LoadSessionResponse,
  NewSessionResponse,
  SessionNotification,
  ResumeSessionResponse,
  SessionConfigOption,
  SessionConfigSelectOption,
  SetSessionConfigOptionResponse,
} from "@agentclientprotocol/sdk"
import type { AssistantMessage, Event, OpencodeClient, SessionMessageResponse, ToolPart } from "@opencode-ai/sdk/v2"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Effect, ManagedRuntime } from "effect"
import { Agent } from "@/acp/agent"
import * as ACPService from "@/acp/service"
import * as ACPError from "@/acp/error"
import { ACPSession } from "@/acp/session"
import { Subagent } from "@/acp/subagent"
import { UsageService } from "@/acp/usage"
import type { Provider } from "@/provider/provider"

const providerID = ProviderV2.ID.make("test")
const modelID = ModelV2.ID.make("test-model")
const configuredModelID = ModelV2.ID.make("configured-model")
const secondModelID = ModelV2.ID.make("second-model")

function makeSessionService() {
  return ManagedRuntime.make(LayerNode.compile(ACPSession.node)).runSync(
    ACPSession.Service.use((service) => Effect.succeed(service)),
  )
}

const provider: Provider.Info = {
  id: providerID,
  name: "Test",
  source: "config",
  env: [],
  options: {},
  models: {
    [modelID]: {
      id: modelID,
      providerID,
      api: {
        id: modelID,
        url: "https://example.com",
        npm: "@ai-sdk/openai-compatible",
      },
      name: "Test Model",
      family: "test",
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: false,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: {
        input: 0,
        output: 0,
        cache: { read: 0, write: 0 },
      },
      limit: {
        context: 128000,
        output: 4096,
      },
      status: "active",
      options: {},
      headers: {},
      release_date: "2026-01-01",
      variants: {
        default: {},
        high: { reasoningEffort: "high" },
      },
    },
    [configuredModelID]: {
      id: configuredModelID,
      providerID,
      api: {
        id: configuredModelID,
        url: "https://example.com",
        npm: "@ai-sdk/openai-compatible",
      },
      name: "Configured Model",
      family: "test",
      capabilities: {
        temperature: true,
        reasoning: false,
        attachment: false,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: {
        input: 0,
        output: 0,
        cache: { read: 0, write: 0 },
      },
      limit: {
        context: 128000,
        output: 4096,
      },
      status: "active",
      options: {},
      headers: {},
      release_date: "2026-01-01",
    },
    [secondModelID]: {
      id: secondModelID,
      providerID,
      api: {
        id: secondModelID,
        url: "https://example.com",
        npm: "@ai-sdk/openai-compatible",
      },
      name: "Second Model",
      family: "test",
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: false,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: {
        input: 0,
        output: 0,
        cache: { read: 0, write: 0 },
      },
      limit: {
        context: 128000,
        output: 4096,
      },
      status: "active",
      options: {},
      headers: {},
      release_date: "2026-01-01",
      variants: {
        low: { reasoningEffort: "low" },
        medium: { reasoningEffort: "medium" },
      },
    },
  },
}

function createEventStream() {
  const queue: Array<{ payload?: Event }> = []
  const waiters: Array<(value: { payload?: Event } | undefined) => void> = []
  const listeners = new Set<(event: Event) => void>()
  const ready = Promise.withResolvers<void>()
  let opened = false

  const push = (event: Event) => {
    for (const listener of listeners) listener(event)
    const envelope = { payload: event }
    const waiter = waiters.shift()
    if (waiter) {
      waiter(envelope)
      return
    }
    queue.push(envelope)
  }

  const stream = async function* (signal?: AbortSignal) {
    if (!opened) {
      opened = true
      ready.resolve()
    }
    while (!signal?.aborted) {
      const queued = queue.shift()
      if (queued) {
        yield queued
        continue
      }
      const next = await new Promise<{ payload?: Event } | undefined>((resolve) => {
        waiters.push(resolve)
        signal?.addEventListener("abort", () => resolve(undefined), { once: true })
      })
      if (!next) return
      yield next
    }
  }

  return {
    push,
    ready: ready.promise,
    subscribe: (listener: (event: Event) => void) => {
      listeners.add(listener)
      ready.resolve()
      return () => listeners.delete(listener)
    },
    globalEvent: (options?: { signal?: AbortSignal }) => Promise.resolve({ stream: stream(options?.signal) }),
  }
}

function textPartUpdated(sessionID: string, messageID: string, partID: string, text: string): Event {
  return {
    id: `updated_${text}`,
    type: "message.part.updated",
    properties: {
      sessionID,
      time: Date.now(),
      part: {
        id: partID,
        sessionID,
        messageID,
        type: "text",
        text,
      },
    },
  }
}

function textPartDelta(sessionID: string, messageID: string, partID: string, delta: string): Event {
  return {
    id: `delta_${delta}`,
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

function assistantTextMessage(
  sessionID: string,
  messageID: string,
  partID: string,
  text: string,
): SessionMessageResponse {
  return {
    info: {
      id: messageID,
      sessionID,
      role: "assistant",
      time: { created: Date.now() },
      parentID: "parent",
      modelID,
      providerID,
      mode: "build",
      agent: "build",
      path: { cwd: "/workspace", root: "/workspace" },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
    },
    parts: [
      {
        id: partID,
        sessionID,
        messageID,
        type: "text",
        text,
      },
    ],
  }
}

function runningTool(sessionID: string, callID: string, output: string) {
  return {
    id: `part_${callID}`,
    sessionID,
    messageID: `msg_${callID}`,
    type: "tool",
    callID,
    tool: "bash",
    state: {
      status: "running",
      input: { cmd: "printf latest" },
      title: "bash",
      metadata: { output },
      time: { start: Date.now() },
    },
  } satisfies ToolPart
}

function toolPartUpdated(part: ToolPart): Event {
  return {
    id: `updated_${part.callID}_${part.state.status}`,
    type: "message.part.updated",
    properties: {
      sessionID: part.sessionID,
      time: Date.now(),
      part,
    },
  }
}

function assistantToolMessage(part: ToolPart): SessionMessageResponse {
  return {
    info: {
      id: part.messageID,
      sessionID: part.sessionID,
      role: "assistant",
      time: { created: Date.now() },
      parentID: "parent",
      modelID,
      providerID,
      mode: "build",
      agent: "build",
      path: { cwd: "/workspace", root: "/workspace" },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
    },
    parts: [part],
  }
}

describe("ACP service sessions", () => {
  const makeService = (
    messages: readonly { info: unknown; parts: readonly unknown[] }[] = [],
    options?: {
      abort?: (input: { sessionID: string }) => Promise<{ data: boolean }>
      get?: (input: { sessionID: string }) => Promise<{ data: { id: string; parentID?: string } }>
      globalEvent?: (options?: { signal?: AbortSignal }) => Promise<{
        stream: AsyncIterable<{ payload?: Event }>
      }>
      eventBarrierPublisher?: (event: Event) => void
      eventSubscriber?: (listener: (event: Event) => void) => () => void
      messages?: () => Promise<{ data: readonly { info: unknown; parts: readonly unknown[] }[] }>
      observeEvent?: (event: Event) => void | Promise<void>
      onSessionUpdate?: (update: SessionNotification) => void | Promise<void>
      prompt?: (input: unknown) => Promise<{ data: { info: ReturnType<typeof assistantInfo> } }>
      session?: ACPSession.Interface
      sessions?: Array<{
        id: string
        directory: string
        title: string
        time: { created: number; updated: number }
      }>
    },
  ) => {
    const defaultEvents = createEventStream()
    const updates: SessionNotification[] = []
    const mcpAdds: string[] = []
    const aborts: string[] = []
    const forks: string[] = []
    const prompts: unknown[] = []
    const commands: unknown[] = []
    const summarizes: unknown[] = []
    const usageUpdates: string[] = []
    const sessions =
      options?.sessions ??
      Array.from({ length: 102 }, (_, index) => ({
        id: `ses_${index + 1}`,
        directory: index % 2 === 0 ? "/workspace" : "/other",
        title: `Session ${index + 1}`,
        time: { created: index + 1, updated: index + 1 },
      }))
    const sdk = {
      config: {
        providers: () => Promise.resolve({ data: { providers: [provider], default: { test: modelID } } }),
        get: () => Promise.resolve({ data: {} }),
      },
      app: {
        agents: () =>
          Promise.resolve({
            data: [
              { name: "build", mode: "primary", permission: [], options: {} },
              { name: "plan", mode: "primary", description: "Plan first", permission: [], options: {} },
              { name: "hidden", mode: "primary", hidden: true, permission: [], options: {} },
            ],
          }),
        skills: () =>
          Promise.resolve({
            data: [{ name: "review-skill", description: "Review", location: "/skills/review", content: "review" }],
          }),
      },
      command: {
        list: () =>
          Promise.resolve({
            data: [{ name: "init", description: "Initialize", source: "command", template: "init", hints: [] }],
          }),
      },
      session: {
        create: () => Promise.resolve({ data: { id: "ses_new" } }),
        get: options?.get ?? (() => Promise.resolve({ data: { id: "ses_loaded" } })),
        list: (input: { directory?: string; limit?: number }) => {
          const filtered = input.directory
            ? sessions.filter((session) => session.directory === input.directory)
            : sessions
          return Promise.resolve({
            data: filtered.slice(0, input.limit ?? 100),
          })
        },
        messages: options?.messages ?? (() => Promise.resolve({ data: messages })),
        children: () => Promise.resolve({ data: [] }),
        status: () =>
          Promise.resolve({
            data: Object.fromEntries(sessions.map((item) => [item.id, { type: "idle" as const }])),
          }),
        prompt:
          options?.prompt ??
          ((input: unknown) => {
            prompts.push(input)
            return Promise.resolve({
              data: {
                info: assistantInfo({
                  input: 100,
                  output: 40,
                  reasoning: 7,
                  cache: { read: 11, write: 13 },
                }),
              },
            })
          }),
        command: (input: unknown) => {
          commands.push(input)
          return Promise.resolve({
            data: {
              info: assistantInfo({
                input: 3,
                output: 4,
                reasoning: 0,
                cache: { read: 0, write: 0 },
              }),
            },
          })
        },
        summarize: (input: unknown) => {
          summarizes.push(input)
          return Promise.resolve({ data: true })
        },
        abort:
          options?.abort ??
          ((input: { sessionID: string }) => {
            aborts.push(input.sessionID)
            return Promise.resolve({ data: true })
          }),
        fork: (input: { sessionID: string }) => {
          forks.push(input.sessionID)
          return Promise.resolve({ data: { id: `fork_${input.sessionID}` } })
        },
      },
      mcp: {
        add: (input: { name?: string }) => {
          if (input.name) mcpAdds.push(input.name)
          return Promise.resolve({ data: {} })
        },
      },
      global: {
        event: options?.globalEvent ?? defaultEvents.globalEvent,
      },
    } as unknown as OpencodeClient
    const connection = {
      sessionUpdate: (update: SessionNotification) => {
        updates.push(update)
        return Promise.resolve(options?.onSessionUpdate?.(update)).then(() => undefined)
      },
      extNotification: () => Promise.resolve(),
    } as Pick<AgentSideConnection, "sessionUpdate" | "extNotification">
    const usage = UsageService.Service.of({
      buildUsage: UsageService.buildUsage,
      latestAssistantMessage: UsageService.latestAssistantMessage,
      totalSessionCost: UsageService.totalSessionCost,
      contextLimit: () => Effect.succeed(128000),
      sendUpdate: (input) =>
        Effect.sync(() => {
          usageUpdates.push(input.sessionID)
        }),
    })

    return {
      service: ACPService.make({
        sdk,
        connection,
        usage,
        eventBarrierPublisher: options?.eventBarrierPublisher ?? defaultEvents.push,
        eventSubscriber: options?.eventSubscriber ?? defaultEvents.subscribe,
        session: options?.session,
        ...(options?.observeEvent
          ? {
              eventSubscription: (subscription) => {
                subscription.addListener(async (event) => {
                  await options.observeEvent?.(event)
                })
              },
            }
          : {}),
      }),
      updates,
      mcpAdds,
      aborts,
      forks,
      prompts,
      commands,
      summarizes,
      usageUpdates,
    }
  }

  it("advertises and dispatches the version-1 subagent extension", async () => {
    const { service } = makeService()
    const agent = new Agent(service)

    const initialized = await agent.initialize({ protocolVersion: 1 })
    expect(initialized._meta).toEqual({
      "opencode.dev/subagents": {
        version: 1,
        list: true,
        subscribe: true,
      },
    })

    const listed = Subagent.decodeSnapshot(await agent.extMethod("_opencode/subagents/list", {}))
    const subscribed = Subagent.decodeSnapshot(await agent.extMethod("_opencode/subagents/subscribe", {}))
    expect(listed.nodes).toHaveLength(102)
    expect(subscribed.nodes).toHaveLength(102)

    await expect(agent.extMethod("_opencode/subagents/missing", {})).rejects.toMatchObject({
      code: -32601,
    })
  })

  it("creates a backed session with config options and command update", async () => {
    const { service, updates, mcpAdds } = makeService()
    const result = await Effect.runPromise(
      service.newSession({
        cwd: "/workspace",
        mcpServers: [
          { name: "tools", command: "node", args: ["server.js"], env: [] },
          { name: "tools", command: "node", args: ["server.js"], env: [] },
        ],
      }),
    )

    await new Promise((resolve) => setTimeout(resolve, 5))

    expect(result.sessionId).toBe("ses_new")
    expect(categories(result)).toContain("model")
    expect(categories(result)).toContain("thought_level")
    expect(categories(result)).toContain("mode")
    expect(updates).toHaveLength(1)
    expect(JSON.stringify(updates[0])).toContain("available_commands_update")
    expect(JSON.stringify(updates[0])).toContain("review-skill")
    expect(mcpAdds).toEqual(["tools"])
  })

  it("loads a session and restores model variant and mode from messages", async () => {
    const { service } = makeService([
      {
        info: {
          role: "assistant",
          providerID: "test",
          modelID: "test-model",
          variant: "high",
          mode: "plan",
        },
        parts: [],
      },
    ])
    const result = await Effect.runPromise(
      service.loadSession({ cwd: "/workspace", sessionId: "ses_loaded", mcpServers: [] }),
    )

    expect(result.configOptions?.find((option) => option.id === "effort")?.currentValue).toBe("high")
    expect(result.configOptions?.find((option) => option.id === "mode")?.currentValue).toBe("plan")
  })

  it("replays loaded session transcript chunks", async () => {
    const { service, updates } = makeService([
      {
        info: { id: "msg_user", sessionID: "ses_loaded", role: "user" },
        parts: [{ id: "part_user", sessionID: "ses_loaded", messageID: "msg_user", type: "text", text: "hello" }],
      },
      {
        info: { id: "msg_assistant", sessionID: "ses_loaded", role: "assistant" },
        parts: [
          {
            id: "part_assistant",
            sessionID: "ses_loaded",
            messageID: "msg_assistant",
            type: "text",
            text: "hi there",
          },
        ],
      },
    ])

    await Effect.runPromise(service.loadSession({ cwd: "/workspace", sessionId: "ses_loaded", mcpServers: [] }))

    expect(
      updates
        .map((item) => item.update)
        .filter((item) => item.sessionUpdate === "user_message_chunk" || item.sessionUpdate === "agent_message_chunk"),
    ).toEqual([
      {
        sessionUpdate: "user_message_chunk",
        messageId: "msg_user",
        content: { type: "text", text: "hello" },
      },
      {
        sessionUpdate: "agent_message_chunk",
        messageId: "msg_assistant",
        content: { type: "text", text: "hi there" },
      },
    ])
  })

  it("reconciles a fenced load snapshot with transient and later child deltas exactly once", async () => {
    const events = createEventStream()
    const coveredObserved = Promise.withResolvers<void>()
    const baseline = assistantTextMessage("ses_loaded", "msg_live", "part_live", "")
    let messageReads = 0
    let liveDeltaSent = false
    const { service, updates } = makeService([], {
      globalEvent: events.globalEvent,
      eventBarrierPublisher: events.push,
      eventSubscriber: events.subscribe,
      messages: async () => {
        messageReads++
        if (messageReads === 1) {
          events.push(textPartUpdated("ses_loaded", "msg_live", "part_live", "covered"))
          events.push(textPartDelta("ses_loaded", "msg_live", "part_live", "covered"))
          await coveredObserved.promise
        }
        return { data: [baseline] }
      },
      observeEvent: (event) => {
        if (event.id === "delta_covered") coveredObserved.resolve()
      },
      onSessionUpdate: (notification) => {
        if (
          !liveDeltaSent &&
          notification.sessionId === "ses_loaded" &&
          notification.update.sessionUpdate === "agent_message_chunk" &&
          notification.update.content.type === "text" &&
          notification.update.content.text === "covered"
        ) {
          liveDeltaSent = true
          events.push(textPartDelta("ses_loaded", "msg_live", "part_live", " live"))
        }
      },
    })
    await events.ready

    await Effect.runPromise(service.loadSession({ cwd: "/workspace", sessionId: "ses_loaded", mcpServers: [] }))

    const text = updates
      .filter(
        (notification) =>
          notification.sessionId === "ses_loaded" &&
          notification.update.sessionUpdate === "agent_message_chunk" &&
          notification.update.content.type === "text",
      )
      .map((notification) =>
        notification.update.sessionUpdate === "agent_message_chunk" && notification.update.content.type === "text"
          ? notification.update.content.text
          : "",
      )
      .join("")
    expect(messageReads).toBe(1)
    expect(text).toBe("covered live")
    service.close()
  })

  it("opens a continuously streaming session from one causally fenced snapshot", async () => {
    const events = createEventStream()
    let messageReads = 0
    let observedEvents = 0
    const baseline = assistantTextMessage("ses_loaded", "msg_churn", "part_churn", "")
    const deltas = Array.from({ length: 8 }, (_, index) => `delta_${index + 1}`)
    const { service, updates } = makeService([], {
      globalEvent: events.globalEvent,
      eventBarrierPublisher: events.push,
      eventSubscriber: events.subscribe,
      messages: async () => {
        messageReads++
        for (const delta of deltas) {
          events.push(textPartDelta("ses_loaded", "msg_churn", "part_churn", delta))
        }
        while (observedEvents < deltas.length) {
          await new Promise((resolve) => setTimeout(resolve, 0))
        }
        return { data: [baseline] }
      },
      observeEvent: () => {
        observedEvents++
      },
    })
    await events.ready

    await Effect.runPromise(service.loadSession({ cwd: "/workspace", sessionId: "ses_loaded", mcpServers: [] }))

    const text = updates
      .filter(
        (notification) =>
          notification.sessionId === "ses_loaded" &&
          notification.update.sessionUpdate === "agent_message_chunk" &&
          notification.update.content.type === "text",
      )
      .map((notification) =>
        notification.update.sessionUpdate === "agent_message_chunk" && notification.update.content.type === "text"
          ? notification.update.content.text
          : "",
      )
      .join("")
    expect(messageReads).toBe(1)
    expect(text).toBe(deltas.join(""))
    service.close()
  })

  it("rejects a concurrent load until post-fence live events finish draining", async () => {
    const events = createEventStream()
    const liveStarted = Promise.withResolvers<void>()
    const releaseLive = Promise.withResolvers<void>()
    const baseline = assistantTextMessage("ses_loaded", "msg_drain_lock", "part_drain_lock", "")
    let barriers = 0
    const { service } = makeService([baseline], {
      eventSubscriber: events.subscribe,
      eventBarrierPublisher: (event) => {
        events.push(event)
        barriers++
        if (barriers === 2) {
          events.push(textPartDelta("ses_loaded", "msg_drain_lock", "part_drain_lock", "live"))
        }
      },
      onSessionUpdate: (notification) => {
        if (
          notification.update.sessionUpdate !== "agent_message_chunk" ||
          notification.update.content.type !== "text" ||
          notification.update.content.text !== "live"
        ) {
          return
        }
        liveStarted.resolve()
        return releaseLive.promise
      },
    })

    const first = Effect.runPromise(service.loadSession({ cwd: "/workspace", sessionId: "ses_loaded", mcpServers: [] }))
    await liveStarted.promise
    const concurrent = Effect.runPromise(
      service.loadSession({ cwd: "/workspace", sessionId: "ses_loaded", mcpServers: [] }),
    )
    const concurrentRejected = expect(concurrent).rejects.toMatchObject({
      _tag: "ACPServiceFailureError",
      safeMessage: "Session is already being loaded",
    })
    await new Promise((resolve) => setTimeout(resolve, 5))
    releaseLive.resolve()

    await first
    await concurrentRejected
    service.close()
  })

  it("removes a newly registered ACP session when replay finish fails", async () => {
    const events = createEventStream()
    const session = makeSessionService()
    const baseline = assistantTextMessage("ses_loaded", "msg_overflow", "part_overflow", "baseline")
    let liveSent = false
    let overflowSent = false
    const { service } = makeService([baseline], {
      eventBarrierPublisher: events.push,
      eventSubscriber: events.subscribe,
      session,
      onSessionUpdate: (notification) => {
        if (notification.update.sessionUpdate !== "agent_message_chunk" || notification.update.content.type !== "text")
          return
        if (!liveSent && notification.update.content.text === "baseline") {
          liveSent = true
          events.push(textPartDelta("ses_loaded", "msg_overflow", "part_overflow", " live"))
          return
        }
        if (!overflowSent && notification.update.content.text === " live") {
          overflowSent = true
          events.push(textPartDelta("ses_loaded", "msg_overflow", "part_overflow", "x".repeat(2 * 1024 * 1024)))
        }
      },
    })

    await expect(
      Effect.runPromise(service.loadSession({ cwd: "/workspace", sessionId: "ses_loaded", mcpServers: [] })),
    ).rejects.toMatchObject({ _tag: "ACPServiceFailureError" })

    expect(await Effect.runPromise(session.tryGet("ses_loaded"))).toBeUndefined()
    service.close()
  })

  it("does not retain delivered tool caches after a failed first load", async () => {
    const events = createEventStream()
    const baseline = assistantTextMessage("ses_loaded", "msg_baseline", "part_baseline", "baseline")
    const tool = runningTool("ses_loaded", "call_retry", "latest")
    const replayedTool = assistantToolMessage(tool)
    let messageReads = 0
    let toolSent = false
    let overflowSent = false
    const { service, updates } = makeService([], {
      eventBarrierPublisher: events.push,
      eventSubscriber: events.subscribe,
      messages: () => Promise.resolve({ data: messageReads++ === 0 ? [baseline] : [replayedTool] }),
      onSessionUpdate: (notification) => {
        if (
          !toolSent &&
          notification.update.sessionUpdate === "agent_message_chunk" &&
          notification.update.content.type === "text" &&
          notification.update.content.text === "baseline"
        ) {
          toolSent = true
          events.push(toolPartUpdated(tool))
          return
        }
        if (
          !overflowSent &&
          notification.update.sessionUpdate === "tool_call_update" &&
          notification.update.toolCallId === "call_retry"
        ) {
          overflowSent = true
          events.push(textPartDelta("ses_loaded", "msg_overflow", "part_overflow", "x".repeat(2 * 1024 * 1024)))
        }
      },
    })

    await expect(
      Effect.runPromise(service.loadSession({ cwd: "/workspace", sessionId: "ses_loaded", mcpServers: [] })),
    ).rejects.toMatchObject({ _tag: "ACPServiceFailureError" })

    const beforeRetry = updates.length
    await Effect.runPromise(service.loadSession({ cwd: "/workspace", sessionId: "ses_loaded", mcpServers: [] }))

    const retryTools = updates.slice(beforeRetry).filter((notification) => {
      return (
        notification.update.sessionUpdate === "tool_call" || notification.update.sessionUpdate === "tool_call_update"
      )
    })
    expect(retryTools.map((notification) => notification.update.sessionUpdate)).toEqual([
      "tool_call",
      "tool_call_update",
    ])
    expect(retryTools[1]?.update).toMatchObject({
      content: [{ type: "content", content: { type: "text", text: "latest" } }],
    })
    service.close()
  })

  it("restores exact pre-load ACP session state when replay finish fails", async () => {
    const events = createEventStream()
    const session = makeSessionService()
    await Effect.runPromise(
      session.create({
        id: "ses_loaded",
        cwd: "/prior",
        mcpServers: [{ name: "prior", command: "prior-server", args: [], env: [] }],
        createdAt: new Date(1234),
        model: { providerID, modelID: secondModelID },
        variant: "medium",
        modeId: "plan",
      }),
    )
    await Effect.runPromise(
      session.recordPartMetadata({
        sessionId: "ses_loaded",
        messageId: "msg_prior",
        partId: "part_prior",
        partType: "text",
        role: "assistant",
        metadata: { retained: true },
      }),
    )
    const before = await Effect.runPromise(session.get("ses_loaded"))
    const baseline = assistantTextMessage("ses_loaded", "msg_overflow", "part_overflow", "baseline")
    let emitted = false
    const { service } = makeService([baseline], {
      eventBarrierPublisher: events.push,
      eventSubscriber: events.subscribe,
      session,
      onSessionUpdate: (notification) => {
        if (emitted || notification.update.sessionUpdate !== "agent_message_chunk") return
        emitted = true
        events.push(textPartDelta("ses_loaded", "msg_overflow", "part_overflow", "x".repeat(2 * 1024 * 1024)))
      },
    })

    await expect(
      Effect.runPromise(service.loadSession({ cwd: "/workspace", sessionId: "ses_loaded", mcpServers: [] })),
    ).rejects.toMatchObject({ _tag: "ACPServiceFailureError" })

    expect(await Effect.runPromise(session.get("ses_loaded"))).toEqual(before)
    service.close()
  })

  it("lists sessions sorted by updated time with cursor support", async () => {
    const { service } = makeService()
    const first = await Effect.runPromise(service.listSessions({ cwd: "/workspace" }))
    const second = await Effect.runPromise(service.listSessions({ cwd: "/workspace", cursor: first.nextCursor }))

    expect(first.sessions).toHaveLength(51)
    expect(first.sessions[0]?.sessionId).toBe("ses_101")
    expect(first.sessions.at(-1)?.sessionId).toBe("ses_1")
    expect(first.nextCursor).toBeUndefined()
    expect(second.sessions).toEqual(first.sessions)
  })

  it("includes live ACP sessions before they appear in server-backed session list", async () => {
    const { service } = makeService()
    const created = await Effect.runPromise(service.newSession({ cwd: "/workspace", mcpServers: [] }))
    const listed = await Effect.runPromise(service.listSessions({ cwd: "/workspace" }))

    expect(listed.sessions[0]?.sessionId).toBe(created.sessionId)
    expect(listed.sessions[0]?.cwd).toBe("/workspace")
  })

  it("does not leak a loaded child into the parent-only session list", async () => {
    const { service } = makeService([], {
      get: () => Promise.resolve({ data: { id: "child", parentID: "root" } }),
    })
    await Effect.runPromise(service.loadSession({ sessionId: "child", cwd: "/workspace", mcpServers: [] }))

    const listed = await Effect.runPromise(service.listSessions({ cwd: "/workspace" }))

    expect(listed.sessions.some((session) => session.sessionId === "child")).toBe(false)
  })

  it("lists all sessions with next cursor when the first page is full", async () => {
    const { service } = makeService()
    const first = await Effect.runPromise(service.listSessions({}))
    const second = await Effect.runPromise(service.listSessions({ cursor: first.nextCursor }))
    const legacySecond = await Effect.runPromise(service.listSessions({ cursor: "3" }))

    expect(first.sessions).toHaveLength(100)
    expect(first.sessions[0]?.sessionId).toBe("ses_102")
    expect(first.sessions.at(-1)?.sessionId).toBe("ses_3")
    expect(first.nextCursor).toBe("v1:3:ses_3")
    expect(second.sessions.map((session) => session.sessionId)).toEqual(["ses_2", "ses_1"])
    expect(legacySecond.sessions).toEqual(second.sessions)
  })

  it("does not drop sessions tied at the 100-item cursor boundary", async () => {
    const sessions = Array.from({ length: 102 }, (_, index) => ({
      id: `tied_${String(index + 1).padStart(3, "0")}`,
      directory: "/workspace",
      title: `Tied ${index + 1}`,
      time: { created: index + 1, updated: 1 },
    }))
    const { service } = makeService([], { sessions })

    const first = await Effect.runPromise(service.listSessions({}))
    const second = await Effect.runPromise(service.listSessions({ cursor: first.nextCursor }))
    const ids = [...first.sessions, ...second.sessions].map((session) => session.sessionId)

    expect(first.sessions).toHaveLength(100)
    expect(second.sessions).toHaveLength(2)
    expect(new Set(ids)).toEqual(new Set(sessions.map((session) => session.id)))
  })

  it("resumes a session and stores restored state without replaying transcript chunks", async () => {
    const { service, updates } = makeService([
      {
        info: {
          id: "msg_user",
          sessionID: "ses_resume",
          role: "user",
          model: { providerID: "test", modelID: "test-model", variant: "high" },
          agent: "plan",
        },
        parts: [{ id: "part_user", sessionID: "ses_resume", messageID: "msg_user", type: "text", text: "hello" }],
      },
      {
        info: { id: "msg_assistant", sessionID: "ses_resume", role: "assistant" },
        parts: [
          {
            id: "part_assistant",
            sessionID: "ses_resume",
            messageID: "msg_assistant",
            type: "text",
            text: "hi there",
          },
        ],
      },
    ])
    const resumed = await Effect.runPromise(
      service.resumeSession({ cwd: "/workspace", sessionId: "ses_resume", mcpServers: [] }),
    )
    const updated = await Effect.runPromise(
      service.setSessionConfigOption({ sessionId: "ses_resume", configId: "effort", value: "default" }),
    )

    expect(select(resumed, "effort")?.currentValue).toBe("high")
    expect(select(updated, "effort")?.currentValue).toBe("default")
    expect(
      updates
        .map((item) => item.update)
        .filter((item) => item.sessionUpdate === "user_message_chunk" || item.sessionUpdate === "agent_message_chunk"),
    ).toEqual([])
  })

  it("closes local ACP state and aborts the backing session best-effort", async () => {
    const { service, aborts } = makeService()
    const created = await Effect.runPromise(service.newSession({ cwd: "/workspace", mcpServers: [] }))

    expect(await Effect.runPromise(service.closeSession({ sessionId: created.sessionId }))).toEqual({})
    const missing = await Effect.runPromise(
      service
        .setSessionConfigOption({ sessionId: created.sessionId, configId: "effort", value: "high" })
        .pipe(Effect.mapError(ACPError.toRequestError), Effect.flip),
    )
    expect(missing.code).toBe(-32602)
    expect(aborts).toEqual([created.sessionId])
    expect(await Effect.runPromise(service.closeSession({ sessionId: "missing" }))).toEqual({})
  })

  it("cancel aborts the backing session and keeps the ACP session", async () => {
    const { service, aborts } = makeService()
    const created = await Effect.runPromise(service.newSession({ cwd: "/workspace", mcpServers: [] }))

    await Effect.runPromise(service.cancel({ sessionId: created.sessionId }))

    // The running turn was aborted via the core session API.
    expect(aborts).toEqual([created.sessionId])
    // Unlike closeSession, the ACP session is still present afterwards so
    // the client can keep prompting.
    const stillUsable = await Effect.runPromise(
      service.setSessionConfigOption({ sessionId: created.sessionId, configId: "effort", value: "high" }),
    )
    expect(stillUsable).toBeDefined()
  })

  it("does not fail cancel or close when the backing abort fails", async () => {
    const { service } = makeService([], { abort: () => Promise.reject(new Error("nope")) })
    const created = await Effect.runPromise(service.newSession({ cwd: "/workspace", mcpServers: [] }))

    await Effect.runPromise(service.cancel({ sessionId: created.sessionId }))
    expect(await Effect.runPromise(service.closeSession({ sessionId: created.sessionId }))).toEqual({})
    expect(await Effect.runPromise(service.closeSession({ sessionId: "missing" }))).toEqual({})
  })

  it("forks a session, loads fork state, and returns config options", async () => {
    const { service, forks } = makeService([
      {
        info: {
          role: "assistant",
          providerID: "test",
          modelID: "second-model",
          variant: "medium",
          mode: "plan",
        },
        parts: [],
      },
    ])
    const forked = await Effect.runPromise(
      service.forkSession({ cwd: "/workspace", sessionId: "ses_parent", mcpServers: [] }),
    )
    const updated = await Effect.runPromise(
      service.setSessionConfigOption({ sessionId: forked.sessionId, configId: "effort", value: "low" }),
    )

    expect(forked.sessionId).toBe("fork_ses_parent")
    expect(select(forked, "model")?.currentValue).toBe("test/second-model")
    expect(select(forked, "effort")?.currentValue).toBe("medium")
    expect(select(updated, "effort")?.currentValue).toBe("low")
    expect(forks).toEqual(["ses_parent"])
  })

  it("restores model variant and mode from the latest user message", async () => {
    const { service } = makeService([
      {
        info: {
          role: "user",
          model: { providerID: "test", modelID: "test-model", variant: "default" },
          agent: "build",
        },
        parts: [],
      },
      {
        info: {
          role: "user",
          model: { providerID: "test", modelID: "test-model", variant: "high" },
          agent: "plan",
        },
        parts: [],
      },
    ])
    const result = await Effect.runPromise(
      service.loadSession({ cwd: "/workspace", sessionId: "ses_loaded", mcpServers: [] }),
    )

    expect(result.configOptions?.find((option) => option.id === "effort")?.currentValue).toBe("high")
    expect(result.configOptions?.find((option) => option.id === "mode")?.currentValue).toBe("plan")
  })

  it("maps provider auth failures to auth-required request errors", async () => {
    const service = ACPService.make({
      sdk: {
        config: {
          providers: () => Promise.reject({ name: "ProviderAuthError", data: { providerID: "test" } }),
          get: () => Promise.resolve({ data: {} }),
        },
        app: {
          agents: () => Promise.resolve({ data: [] }),
          skills: () => Promise.resolve({ data: [] }),
        },
        command: {
          list: () => Promise.resolve({ data: [] }),
        },
      } as unknown as OpencodeClient,
    })
    const error = await Effect.runPromise(
      service
        .newSession({ cwd: "/workspace", mcpServers: [] })
        .pipe(Effect.mapError(ACPError.toRequestError), Effect.flip),
    )

    expect(error.code).toBe(-32000)
  })

  it("does not cache failed directory snapshots", async () => {
    let providersCalls = 0
    const sdk = {
      config: {
        providers: () => {
          providersCalls++
          if (providersCalls === 1) {
            return Promise.reject({ name: "ProviderAuthError", data: { providerID: "test" } })
          }
          return Promise.resolve({ data: { providers: [provider], default: { test: modelID } } })
        },
        get: () => Promise.resolve({ data: {} }),
      },
      app: {
        agents: () => Promise.resolve({ data: [{ name: "build", mode: "primary", permission: [], options: {} }] }),
        skills: () => Promise.resolve({ data: [] }),
      },
      command: {
        list: () => Promise.resolve({ data: [] }),
      },
      session: {
        create: () => Promise.resolve({ data: { id: "ses_retry" } }),
        list: () => Promise.resolve({ data: [] }),
      },
      mcp: {
        add: () => Promise.resolve({ data: {} }),
      },
    } as unknown as OpencodeClient
    const service = ACPService.make({ sdk })

    const first = await Effect.runPromise(
      service
        .newSession({ cwd: "/workspace", mcpServers: [] })
        .pipe(Effect.mapError(ACPError.toRequestError), Effect.flip),
    )
    const second = await Effect.runPromise(service.newSession({ cwd: "/workspace", mcpServers: [] }))

    expect(first.code).toBe(-32000)
    expect(second.sessionId).toBe("ses_retry")
    expect(providersCalls).toBe(2)
  })

  it("registers same-name MCP servers again for different sessions or configs", async () => {
    const adds: unknown[] = []
    let nextSession = 0
    const sdk = {
      config: {
        providers: () => Promise.resolve({ data: { providers: [provider], default: { test: modelID } } }),
        get: () => Promise.resolve({ data: {} }),
      },
      app: {
        agents: () => Promise.resolve({ data: [{ name: "build", mode: "primary", permission: [], options: {} }] }),
        skills: () => Promise.resolve({ data: [] }),
      },
      command: {
        list: () => Promise.resolve({ data: [] }),
      },
      session: {
        create: () => {
          nextSession++
          return Promise.resolve({ data: { id: `ses_${nextSession}` } })
        },
        list: () => Promise.resolve({ data: [] }),
      },
      mcp: {
        add: (input: unknown) => {
          adds.push(input)
          return Promise.resolve({ data: {} })
        },
      },
    } as unknown as OpencodeClient
    const service = ACPService.make({ sdk })

    await Effect.runPromise(
      service.newSession({
        cwd: "/workspace",
        mcpServers: [{ name: "tools", command: "node", args: ["one.js"], env: [] }],
      }),
    )
    await Effect.runPromise(
      service.newSession({
        cwd: "/workspace",
        mcpServers: [{ name: "tools", command: "node", args: ["two.js"], env: [] }],
      }),
    )

    expect(adds).toHaveLength(2)
    expect(JSON.stringify(adds[0])).toContain("one.js")
    expect(JSON.stringify(adds[1])).toContain("two.js")
  })

  it("uses the configured model as the new session default", async () => {
    const sdk = {
      config: {
        providers: () => Promise.resolve({ data: { providers: [provider], default: { test: modelID } } }),
        get: () => Promise.resolve({ data: { model: "test/configured-model" } }),
      },
      app: {
        agents: () => Promise.resolve({ data: [{ name: "build", mode: "primary", permission: [], options: {} }] }),
        skills: () => Promise.resolve({ data: [] }),
      },
      command: {
        list: () => Promise.resolve({ data: [] }),
      },
      session: {
        create: (input: { model?: { id?: string } }) => Promise.resolve({ data: { id: input.model?.id } }),
        list: () => Promise.resolve({ data: [] }),
      },
      mcp: {
        add: () => Promise.resolve({ data: {} }),
      },
    } as unknown as OpencodeClient
    const service = ACPService.make({ sdk })

    const result = await Effect.runPromise(service.newSession({ cwd: "/workspace", mcpServers: [] }))

    expect(result.sessionId).toBe("configured-model")
    expect(result.configOptions?.find((option) => option.id === "model")?.currentValue).toBe("test/configured-model")
  })

  it("does not scan last-used sessions when resolving the new session default", async () => {
    const historyCalls: string[] = []
    const sdk = {
      config: {
        providers: () => Promise.resolve({ data: { providers: [provider], default: { test: modelID } } }),
        get: () => Promise.resolve({ data: {} }),
      },
      app: {
        agents: () => Promise.resolve({ data: [{ name: "build", mode: "primary", permission: [], options: {} }] }),
        skills: () => Promise.resolve({ data: [] }),
      },
      command: {
        list: () => Promise.resolve({ data: [] }),
      },
      session: {
        create: (input: { model?: { id?: string } }) => Promise.resolve({ data: { id: input.model?.id } }),
        list: () => {
          historyCalls.push("list")
          return Promise.resolve({ data: [{ id: "ses_recent" }] })
        },
        messages: () => {
          historyCalls.push("messages")
          return Promise.resolve({
            data: [{ info: { role: "user", model: { providerID: "test", modelID: "second-model" } } }],
          })
        },
      },
      mcp: {
        add: () => Promise.resolve({ data: {} }),
      },
    } as unknown as OpencodeClient
    const service = ACPService.make({ sdk })

    const result = await Effect.runPromise(service.newSession({ cwd: "/workspace", mcpServers: [] }))

    expect(result.sessionId).toBe("test-model")
    expect(result.configOptions?.find((option) => option.id === "model")?.currentValue).toBe("test/test-model")
    expect(historyCalls).toEqual([])
  })

  it("switches model and returns updated model and effort options", async () => {
    const { service } = makeService()
    const session = await Effect.runPromise(service.newSession({ cwd: "/workspace", mcpServers: [] }))
    const updated = await Effect.runPromise(
      service.setSessionConfigOption({
        sessionId: session.sessionId,
        configId: "model",
        value: "test/second-model",
      }),
    )

    expect(select(updated, "model")?.currentValue).toBe("test/second-model")
    expect(select(updated, "effort")?.currentValue).toBe("low")
    expect(flattenSelectOptions(select(updated, "effort")).map((option) => option.value)).toEqual(["low", "medium"])
  })

  it("switches effort and returns the updated effort current value", async () => {
    const { service } = makeService()
    const session = await Effect.runPromise(service.newSession({ cwd: "/workspace", mcpServers: [] }))
    const updated = await Effect.runPromise(
      service.setSessionConfigOption({
        sessionId: session.sessionId,
        configId: "effort",
        value: "high",
      }),
    )

    expect(select(updated, "effort")?.currentValue).toBe("high")
  })

  it("switches mode and returns the updated mode current value", async () => {
    const { service } = makeService()
    const session = await Effect.runPromise(service.newSession({ cwd: "/workspace", mcpServers: [] }))
    const updated = await Effect.runPromise(
      service.setSessionConfigOption({
        sessionId: session.sessionId,
        configId: "mode",
        value: "plan",
      }),
    )

    expect(select(updated, "mode")?.currentValue).toBe("plan")
  })

  it("maps invalid model effort mode and config id to invalid params", async () => {
    const { service } = makeService()
    const session = await Effect.runPromise(service.newSession({ cwd: "/workspace", mcpServers: [] }))

    const results = await Promise.all(
      [
        { configId: "model", value: "test/missing-model" },
        { configId: "effort", value: "max" },
        { configId: "mode", value: "missing-mode" },
        { configId: "missing", value: "value" },
      ].map((input) =>
        Effect.runPromise(
          service
            .setSessionConfigOption({ sessionId: session.sessionId, ...input })
            .pipe(Effect.mapError(ACPError.toRequestError), Effect.flip),
        ),
      ),
    )
    expect(results.map((error) => error.code)).toEqual([-32602, -32602, -32602, -32602])
  })

  it("does not refetch providers modes or commands when switching effort from session snapshot", async () => {
    const calls = {
      providers: 0,
      agents: 0,
      commands: 0,
      skills: 0,
      mcpAdds: 0,
    }
    const sdk = {
      config: {
        providers: () => {
          calls.providers++
          return Promise.resolve({ data: { providers: [provider], default: { test: modelID } } })
        },
        get: () => Promise.resolve({ data: {} }),
      },
      app: {
        agents: () => {
          calls.agents++
          return Promise.resolve({ data: [{ name: "build", mode: "primary", permission: [], options: {} }] })
        },
        skills: () => {
          calls.skills++
          return Promise.resolve({ data: [] })
        },
      },
      command: {
        list: () => {
          calls.commands++
          return Promise.resolve({ data: [] })
        },
      },
      session: {
        create: () => Promise.resolve({ data: { id: "ses_fast" } }),
        list: () => Promise.resolve({ data: [] }),
      },
      mcp: {
        add: () => {
          calls.mcpAdds++
          return Promise.resolve({ data: {} })
        },
      },
    } as unknown as OpencodeClient
    const service = ACPService.make({ sdk })
    const session = await Effect.runPromise(service.newSession({ cwd: "/workspace", mcpServers: [] }))

    expect(calls).toEqual({ providers: 1, agents: 1, commands: 1, skills: 1, mcpAdds: 0 })

    await Effect.runPromise(
      service.setSessionConfigOption({
        sessionId: session.sessionId,
        configId: "effort",
        value: "high",
      }),
    )

    expect(calls).toEqual({ providers: 1, agents: 1, commands: 1, skills: 1, mcpAdds: 0 })
  })

  it("switches model against the warm provider snapshot without refetching", async () => {
    const calls = {
      providers: 0,
      agents: 0,
      commands: 0,
      skills: 0,
    }
    const sdk = {
      config: {
        providers: () => {
          calls.providers++
          return Promise.resolve({ data: { providers: [provider], default: { test: modelID } } })
        },
        get: () => Promise.resolve({ data: {} }),
      },
      app: {
        agents: () => {
          calls.agents++
          return Promise.resolve({ data: [{ name: "build", mode: "primary", permission: [], options: {} }] })
        },
        skills: () => {
          calls.skills++
          return Promise.resolve({ data: [] })
        },
      },
      command: {
        list: () => {
          calls.commands++
          return Promise.resolve({ data: [] })
        },
      },
      session: {
        create: () => Promise.resolve({ data: { id: "ses_model_fast" } }),
        list: () => Promise.resolve({ data: [] }),
      },
      mcp: {
        add: () => Promise.resolve({ data: {} }),
      },
    } as unknown as OpencodeClient
    const service = ACPService.make({ sdk })
    const session = await Effect.runPromise(service.newSession({ cwd: "/workspace", mcpServers: [] }))
    const updated = await Effect.runPromise(
      service.setSessionConfigOption({
        sessionId: session.sessionId,
        configId: "model",
        value: "test/second-model",
      }),
    )

    expect(select(updated, "model")?.currentValue).toBe("test/second-model")
    expect(calls).toEqual({ providers: 1, agents: 1, commands: 1, skills: 1 })
  })

  it("reuses the warm directory snapshot for a second new session in the same cwd", async () => {
    const calls = {
      providers: 0,
      config: 0,
      agents: 0,
      commands: 0,
      skills: 0,
      sessionList: 0,
      messages: 0,
      creates: 0,
    }
    const sdk = {
      config: {
        providers: () => {
          calls.providers++
          return Promise.resolve({ data: { providers: [provider], default: { test: modelID } } })
        },
        get: () => {
          calls.config++
          return Promise.resolve({ data: {} })
        },
      },
      app: {
        agents: () => {
          calls.agents++
          return Promise.resolve({ data: [{ name: "build", mode: "primary", permission: [], options: {} }] })
        },
        skills: () => {
          calls.skills++
          return Promise.resolve({ data: [] })
        },
      },
      command: {
        list: () => {
          calls.commands++
          return Promise.resolve({ data: [] })
        },
      },
      session: {
        create: () => {
          calls.creates++
          return Promise.resolve({ data: { id: `ses_warm_${calls.creates}` } })
        },
        list: () => {
          calls.sessionList++
          return Promise.resolve({ data: [] })
        },
        messages: () => {
          calls.messages++
          return Promise.resolve({ data: [] })
        },
      },
      mcp: {
        add: () => Promise.resolve({ data: {} }),
      },
    } as unknown as OpencodeClient
    const service = ACPService.make({ sdk })

    const first = await Effect.runPromise(service.newSession({ cwd: "/workspace", mcpServers: [] }))
    const second = await Effect.runPromise(service.newSession({ cwd: "/workspace", mcpServers: [] }))

    expect(first.sessionId).toBe("ses_warm_1")
    expect(second.sessionId).toBe("ses_warm_2")
    expect(calls).toEqual({
      providers: 1,
      config: 1,
      agents: 1,
      commands: 1,
      skills: 1,
      sessionList: 0,
      messages: 0,
      creates: 2,
    })
  })

  it("normal text prompt sends model variant mode and converted parts", async () => {
    const { service, prompts, usageUpdates } = makeService()
    const session = await Effect.runPromise(service.newSession({ cwd: "/workspace", mcpServers: [] }))
    await Effect.runPromise(
      service.setSessionConfigOption({
        sessionId: session.sessionId,
        configId: "effort",
        value: "high",
      }),
    )
    await Effect.runPromise(
      service.setSessionConfigOption({
        sessionId: session.sessionId,
        configId: "mode",
        value: "plan",
      }),
    )

    const result = await Effect.runPromise(
      service.prompt({
        sessionId: session.sessionId,
        messageId: "00000000-0000-4000-8000-000000000001",
        prompt: [{ type: "text", text: "hello" }],
      }),
    )

    expect(prompts).toEqual([
      {
        sessionID: session.sessionId,
        model: { providerID, modelID },
        variant: "high",
        parts: [{ type: "text", text: "hello" }],
        agent: "plan",
        directory: "/workspace",
      },
    ])
    expect(result).toEqual({
      stopReason: "end_turn",
      usage: {
        inputTokens: 100,
        outputTokens: 40,
        thoughtTokens: 7,
        cachedReadTokens: 11,
        cachedWriteTokens: 13,
        totalTokens: 171,
      },
      userMessageId: "00000000-0000-4000-8000-000000000001",
      _meta: {},
    })
    expect(usageUpdates).toEqual([session.sessionId])
  })

  it("maps assistant prompt errors to request errors instead of end turn", async () => {
    const { service } = makeService([], {
      prompt: () =>
        Promise.resolve({
          data: {
            info: assistantInfo(
              { input: 8, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              { name: "APIError", data: { message: "Provider request failed", isRetryable: false } },
            ),
          },
        }),
    })
    const session = await Effect.runPromise(service.newSession({ cwd: "/workspace", mcpServers: [] }))

    const error = await Effect.runPromise(
      service
        .prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "hello" }] })
        .pipe(Effect.mapError(ACPError.toRequestError), Effect.flip),
    )

    expect(error.code).toBe(-32603)
    expect(error.message).toBe("Internal error: Provider request failed")
    expect(error.data).toEqual({ service: "session", errorName: "APIError" })
  })

  it("maps aborted assistant prompt errors to cancelled", async () => {
    const { service } = makeService([], {
      prompt: () =>
        Promise.resolve({
          data: {
            info: assistantInfo(
              { input: 8, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
              { name: "MessageAbortedError", data: { message: "Aborted" } },
            ),
          },
        }),
    })
    const session = await Effect.runPromise(service.newSession({ cwd: "/workspace", mcpServers: [] }))

    const result = await Effect.runPromise(
      service.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "hello" }] }),
    )

    expect(result.stopReason).toBe("cancelled")
  })

  it("prompt maps assistant and user audience annotations", async () => {
    const { service, prompts } = makeService()
    const session = await Effect.runPromise(service.newSession({ cwd: "/workspace", mcpServers: [] }))

    await Effect.runPromise(
      service.prompt({
        sessionId: session.sessionId,
        prompt: [
          { type: "text", text: "assistant context", annotations: { audience: ["assistant"] } },
          { type: "text", text: "user context", annotations: { audience: ["user"] } },
        ],
      }),
    )

    expect(prompts).toContainEqual({
      sessionID: session.sessionId,
      model: { providerID, modelID },
      variant: "default",
      parts: [
        { type: "text", text: "assistant context", synthetic: true },
        { type: "text", text: "user context", ignored: true },
      ],
      agent: "build",
      directory: "/workspace",
    })
  })

  it("prompt sends image and resource parts", async () => {
    const { service, prompts } = makeService()
    const session = await Effect.runPromise(service.newSession({ cwd: "/workspace", mcpServers: [] }))

    await Effect.runPromise(
      service.prompt({
        sessionId: session.sessionId,
        prompt: [
          { type: "image", data: "AAAA", mimeType: "image/png", uri: "file:///tmp/screenshot.png" },
          {
            type: "resource",
            resource: {
              uri: "file:///tmp/report.pdf",
              mimeType: "application/pdf",
              blob: "JVBERg==",
            },
          },
        ],
      }),
    )

    expect((prompts[0] as { parts?: unknown }).parts).toEqual([
      {
        type: "file",
        url: "data:image/png;base64,AAAA",
        filename: "screenshot.png",
        mime: "image/png",
      },
      {
        type: "file",
        url: "data:application/pdf;base64,JVBERg==",
        filename: "report.pdf",
        mime: "application/pdf",
      },
    ])
  })

  it("slash command prompt calls session command", async () => {
    const { service, prompts, commands } = makeService()
    const session = await Effect.runPromise(service.newSession({ cwd: "/workspace", mcpServers: [] }))

    const result = await Effect.runPromise(
      service.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "/init now" }] }),
    )

    expect(prompts).toEqual([])
    expect(commands).toEqual([
      {
        sessionID: session.sessionId,
        command: "init",
        arguments: "now",
        model: "test/test-model",
        variant: "default",
        agent: "build",
        directory: "/workspace",
      },
    ])
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 4, totalTokens: 7 })
  })

  it("compact slash command calls summarize path", async () => {
    const { service, prompts, commands, summarizes } = makeService()
    const session = await Effect.runPromise(service.newSession({ cwd: "/workspace", mcpServers: [] }))

    await Effect.runPromise(
      service.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "/compact" }] }),
    )

    expect(prompts).toEqual([])
    expect(commands).toEqual([])
    expect(summarizes).toEqual([
      {
        sessionID: session.sessionId,
        directory: "/workspace",
        providerID,
        modelID,
      },
    ])
  })

  it("maps prompt auth failures to auth-required request errors", async () => {
    const { service } = makeService()
    const session = await Effect.runPromise(service.newSession({ cwd: "/workspace", mcpServers: [] }))
    const failing = ACPService.make({
      sdk: {
        config: {
          providers: () => Promise.resolve({ data: { providers: [provider], default: { test: modelID } } }),
          get: () => Promise.resolve({ data: {} }),
        },
        app: {
          agents: () => Promise.resolve({ data: [{ name: "build", mode: "primary", permission: [], options: {} }] }),
          skills: () => Promise.resolve({ data: [] }),
        },
        command: {
          list: () => Promise.resolve({ data: [] }),
        },
        session: {
          create: () => Promise.resolve({ data: { id: session.sessionId } }),
          list: () => Promise.resolve({ data: [] }),
          prompt: () => Promise.reject({ name: "ProviderAuthError", data: { providerID: "test" } }),
        },
        mcp: {
          add: () => Promise.resolve({ data: {} }),
        },
      } as unknown as OpencodeClient,
      usage: UsageService.Service.of({
        buildUsage: UsageService.buildUsage,
        latestAssistantMessage: UsageService.latestAssistantMessage,
        totalSessionCost: UsageService.totalSessionCost,
        contextLimit: () => Effect.succeed(128000),
        sendUpdate: () => Effect.void,
      }),
    })
    await Effect.runPromise(failing.newSession({ cwd: "/workspace", mcpServers: [] }))
    const error = await Effect.runPromise(
      failing
        .prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "hello" }] })
        .pipe(Effect.mapError(ACPError.toRequestError), Effect.flip),
    )

    expect(error.code).toBe(-32000)
  })
})

function assistantInfo(
  tokens: UsageService.AssistantTokenCost["tokens"],
  error?: AssistantMessage["error"],
): UsageService.AssistantMessage & Pick<AssistantMessage, "error"> {
  return {
    role: "assistant",
    providerID: "test",
    modelID: "test-model",
    cost: 0,
    tokens,
    ...(error ? { error } : {}),
  }
}

function categories(result: NewSessionResponse | LoadSessionResponse) {
  return result.configOptions?.map((option) => option.category) ?? []
}

function select(
  result: SetSessionConfigOptionResponse | ResumeSessionResponse | NewSessionResponse | ForkSessionResponse,
  id: string,
) {
  return result.configOptions?.find(
    (option): option is Extract<SessionConfigOption, { type: "select" }> =>
      option.id === id && option.type === "select",
  )
}

function flattenSelectOptions(option: Extract<SessionConfigOption, { type: "select" }> | undefined) {
  return option?.options.flatMap((item): SessionConfigSelectOption[] => ("value" in item ? [item] : item.options)) ?? []
}
