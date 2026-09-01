import { describe, expect, it } from "bun:test"
import {
  claudeACPConfigCommand,
  claudeACPConfigOptionCurrent,
  claudeACPConfigOptionValues,
  claudeACPElicitationContent,
  claudeACPElicitationFields,
  claudeACPToolEvents,
  claudeContextUsage,
  claudeUsage,
  parseState,
  requestPermissionForActive,
  resolveFastDesired,
  stream,
} from "@/session/llm/claude-acp"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import type { RequestPermissionRequest } from "@agentclientprotocol/sdk"
import { SessionID } from "../../src/session/schema"
import { Effect, Stream } from "effect"

type StreamInput = Parameters<typeof stream>[0]
type AgentFactory = NonNullable<Parameters<typeof stream>[1]>
type ACPClient = Parameters<AgentFactory>[0]
type Agent = Awaited<ReturnType<AgentFactory>>
type ActivePermission = NonNullable<Parameters<typeof requestPermissionForActive>[0]>
type Authorization = Parameters<ActivePermission["authorize"]>[0]
type ToolUpdate = Parameters<typeof claudeACPToolEvents>[1]

describe("Claude ACP", () => {
  it("streams events, resumes continuations, and rejects stale state", async () => {
    const lifecycle = { newSession: 0, resumeSession: 0, dispose: 0 }
    const prompts: string[] = []
    const firstIdle = Promise.withResolvers<void>()
    const idles: Array<() => void> = []
    let agents = 0
    const factory: AgentFactory = async (client) => {
      expect(lifecycle.dispose).toBe(agents)
      const sessionID = `claude_session_${++agents}`
      return testAgent({
        initialize: async (input) => {
          expect(input).toMatchObject({ clientInfo: { name: "OpenCode" } })
          return { protocolVersion: 1 }
        },
        newSession: async (input) => {
          lifecycle.newSession++
          expect(input).toMatchObject({
            cwd: "/workspace",
            mcpServers: [{ name: "tools", command: "bun" }],
            _meta: {
              systemPrompt: { type: "preset", preset: "claude_code", append: "Follow OpenCode instructions." },
            },
          })
          return { sessionId: sessionID, configOptions: [] }
        },
        resumeSession: async () => {
          lifecycle.resumeSession++
          return { configOptions: [] }
        },
        prompt: async (input) => {
          prompts.push(input.prompt[0]?.type === "text" ? input.prompt[0].text : "")
          if (prompts.length === 1) {
            await sessionUpdate(client, sessionID, {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "hello" },
            })
            await sessionUpdate(client, sessionID, { sessionUpdate: "usage_update", used: 42, size: 200_000 })
            await sessionUpdate(
              client,
              sessionID,
              toolUpdate({ sessionUpdate: "tool_call", status: "completed", rawOutput: "contents" }),
            )
            await client.extNotification("_claude/sdkMessage", {
              sessionId: "another_session",
              message: { type: "system", subtype: "session_state_changed", state: "idle" },
            })
            void firstIdle.promise.then(async () => {
              await sessionUpdate(client, sessionID, {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "late background output" },
              })
              await client.extNotification("_claude/sdkMessage", {
                sessionId: input.sessionId,
                message: { type: "system", subtype: "session_state_changed", state: "idle" },
              })
            })
          } else if (prompts.length === 2) {
            expect(lifecycle.dispose).toBe(0)
            await client.extNotification("_claude/sdkMessage", {
              sessionId: input.sessionId,
              message: { type: "system", subtype: "session_state_changed", state: "idle" },
            })
          } else {
            idles.push(
              () =>
                void client.extNotification("_claude/sdkMessage", {
                  sessionId: input.sessionId,
                  message: { type: "system", subtype: "session_state_changed", state: "idle" },
                }),
            )
          }
          return {
            stopReason: prompts.length === 4 ? "max_turn_requests" : "end_turn",
            usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
          }
        },
        dispose: async () => {
          if (sessionID === "claude_session_1")
            await sessionUpdate(client, sessionID, {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "late background output" },
            })
          lifecycle.dispose++
        },
      })
    }
    const first = streamInput()
    const events = await collect(first, factory)
    const state = streamState(events)

    expect(events.map((event) => event.type).join(" ")).toBe(
      "step-start text-start text-delta usage text-end tool-call tool-result step-finish finish",
    )
    expect(events.find((event) => event.type === "step-finish")).toMatchObject({ usage: { totalTokens: 42 } })
    expect(state).toMatchObject({ owner: "ses_claude_resume", sessionID: "claude_session_1", transcript: { count: 1 } })

    const second = streamInput({
      assistantID: "msg_assistant_2",
      historyID: "msg_assistant",
      messages: [...first.messages, { role: "assistant", content: "hello" }, { role: "user", content: "again" }],
      state,
    })
    const secondRun = collect(second, factory)
    await Bun.sleep(0)
    expect(prompts).toHaveLength(1)
    firstIdle.resolve()
    const secondEvents = await secondRun
    expect(secondEvents.some((event) => event.type === "text-delta")).toBe(false)
    const secondState = streamState(secondEvents)
    const third = streamInput({
      assistantID: "msg_assistant_3",
      historyID: "msg_assistant_2",
      messages: [...second.messages, { role: "assistant", content: "again" }, { role: "user", content: "third" }],
      state: { ...secondState!, transcript: { ...secondState!.transcript!, hash: "stale" } },
    })
    const thirdRun = collect(third, factory)
    await Bun.sleep(0)
    await clientIdle(idles)
    await thirdRun
    const limitedRun = collect(
      {
        ...third,
        assistantID: "msg_assistant_4",
        state: secondState,
        messages: [...third.messages, { role: "assistant", content: "Stop after this step" }],
      },
      factory,
    )
    await Bun.sleep(0)
    await clientIdle(idles)
    const limited = await limitedRun

    expect(agents).toBe(3)
    expect(prompts.slice(0, 2)).toEqual(["USER:\nhello", "again"])
    expect(prompts[3]).toBe("USER:\nthird\n\nASSISTANT:\nStop after this step")
    expect(limited.find((event) => event.type === "step-finish")).toMatchObject({ reason: "length" })
    expect(lifecycle).toEqual({ newSession: 2, resumeSession: 1, dispose: 2 })
  })

  it("disposes an agent aborted during setup and clears resumable state", async () => {
    const abort = new AbortController()
    const lifecycle: string[] = []
    const events = await collect(
      streamInput({
        sessionID: SessionID.make("ses_claude_abort"),
        abort: abort.signal,
        state: {
          owner: "ses_claude_abort",
          fingerprint: "previous",
          modelID: "claude",
          sessionID: "discarded",
          transcript: { count: 1, hash: "discarded" },
          config: { effort: "max" },
        },
      }),
      async () =>
        testAgent({
          initialize: async () => {
            lifecycle.push("initialize")
            abort.abort()
            return { protocolVersion: 1 }
          },
          dispose: async () => void lifecycle.push("dispose"),
        }),
    )

    expect(events.find((event) => event.type === "step-finish")).toMatchObject({
      reason: "error",
      providerMetadata: {
        anthropic: {
          claudeACP: {
            owner: "ses_claude_abort",
            fingerprint: "previous",
            modelID: "claude",
            config: { effort: "max" },
          },
        },
      },
    })
    expect(lifecycle).toEqual(["initialize", "dispose"])
  })

  it("cancels and disposes an agent aborted during a prompt", async () => {
    const abort = new AbortController()
    const started = Promise.withResolvers<void>()
    const cancelled = Promise.withResolvers<{ stopReason: "cancelled" }>()
    const lifecycle: string[] = []
    const result = collect(
      streamInput({ sessionID: SessionID.make("ses_claude_prompt_abort"), abort: abort.signal }),
      async () =>
        testAgent({
          prompt: () => {
            started.resolve()
            return cancelled.promise
          },
          cancel: async () => {
            lifecycle.push("cancel")
            cancelled.resolve({ stopReason: "cancelled" })
          },
          dispose: async () => void lifecycle.push("dispose"),
        }),
    )
    await started.promise
    abort.abort()

    const events = await result
    expect(events.find((event) => event.type === "step-finish")).toMatchObject({
      reason: "error",
      providerMetadata: { anthropic: { claudeACP: { owner: "ses_claude_prompt_abort", config: {} } } },
    })
    expect(streamState(events)?.sessionID).toBeUndefined()
    expect(lifecycle).toEqual(["cancel", "dispose"])
  })

  it("fails before creating an agent when history contains media", async () => {
    let created = false
    await expect(
      collect(
        streamInput({
          sessionID: SessionID.make("ses_claude_media"),
          messages: [{ role: "user", content: [{ type: "file", mediaType: "image/png", data: "image" }] }],
        }),
        async () => {
          created = true
          throw new Error("unreachable")
        },
      ),
    ).rejects.toThrow("Claude ACP does not support file or image history")
    await expect(
      collect(
        streamInput({
          sessionID: SessionID.make("ses_claude_tool_media"),
          messages: [
            {
              role: "tool",
              content: [
                {
                  type: "tool-result",
                  toolCallId: "call_read",
                  toolName: "read",
                  output: {
                    type: "content",
                    value: [{ type: "media", mediaType: "image/png", data: "image" }],
                  },
                },
              ],
            },
          ],
        }),
        async () => {
          created = true
          throw new Error("unreachable")
        },
      ),
    ).rejects.toThrow("Claude ACP does not support file or image history")
    expect(created).toBe(false)
  })

  it("hands Claude compaction back to OpenCode and disposes native state", async () => {
    let disposed = false
    const events = await collect(streamInput(), async (client) =>
      testAgent({
        prompt: async () => {
          await sessionUpdate(client, "test_session", {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Compacting..." },
          })
          await sessionUpdate(client, "test_session", {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Compacting completed." },
          })
          return { stopReason: "end_turn" }
        },
        dispose: async () => void (disposed = true),
      }),
    )

    expect(events.some((event) => event.type === "text-delta")).toBe(false)
    expect(events.find((event) => event.type === "step-finish")).toMatchObject({
      providerMetadata: {
        anthropic: { claudeACP: { owner: "ses_claude_resume", config: {} }, acpCompacted: true },
      },
    })
    expect(streamState(events)?.sessionID).toBeUndefined()
    expect(disposed).toBe(true)
  })

  it("preserves the compaction handoff when the native prompt rejects", async () => {
    const events = await collect(streamInput(), async (client) =>
      testAgent({
        prompt: async () => {
          await sessionUpdate(client, "test_session", { sessionUpdate: "usage_update", used: 42, size: 200_000 })
          await sessionUpdate(client, "test_session", {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Compacting completed." },
          })
          throw new Error("prompt failed after compaction")
        },
      }),
    )

    expect(events.find((event) => event.type === "step-finish")).toMatchObject({
      reason: "error",
      providerMetadata: {
        anthropic: { claudeACP: { owner: "ses_claude_resume", config: {} }, acpCompacted: true },
      },
      usage: { totalTokens: 42 },
    })
    expect(streamState(events)?.sessionID).toBeUndefined()
  })

  it("parses local config commands and applies picker aliases", async () => {
    expect(claudeACPConfigCommand("/effort max")).toEqual({ configId: "effort", value: "max" })
    expect(claudeACPConfigCommand("/fast")).toEqual({ configId: "fast", value: undefined })
    expect(claudeACPConfigCommand("/compact")).toBeUndefined()
    expect(resolveFastDesired(undefined, "on")).toBe(false)
    expect(resolveFastDesired("nope", "off")).toBe("invalid")
    expect(
      claudeACPConfigOptionValues({
        id: "effort",
        name: "Effort",
        type: "select",
        currentValue: "default",
        options: [
          { value: "default", name: "Default" },
          { value: "max", name: "Max" },
        ],
      }),
    ).toEqual(["default", "max"])
    expect(claudeACPConfigOptionCurrent({ id: "fast", name: "Fast", type: "boolean", currentValue: true })).toBe("on")

    let configured: unknown
    await collect(
      streamInput({ modelID: "fable", resume: false, messages: [{ role: "user", content: "/model" }] }),
      async () =>
        testAgent({
          newSession: async () => ({
            sessionId: "fable_session",
            configOptions: [
              {
                id: "model",
                name: "Model",
                type: "select",
                currentValue: "sonnet",
                options: [{ value: "claude-fable-5", name: "Fable" }],
              },
            ],
          }),
          setSessionConfigOption: async (input) => {
            configured = input
            return { configOptions: [] }
          },
        }),
    )
    expect(configured).toMatchObject({ configId: "model", value: "claude-fable-5" })
  })

  it("maps inclusive usage and live context occupancy", () => {
    expect(
      claudeUsage(
        {
          inputTokens: 100,
          outputTokens: 25,
          cachedReadTokens: 30,
          cachedWriteTokens: 10,
          thoughtTokens: 5,
          totalTokens: 165,
        },
        { used: 32_000, size: 200_000 },
      ),
    ).toMatchObject({
      inputTokens: 140,
      nonCachedInputTokens: 100,
      cacheReadInputTokens: 30,
      cacheWriteInputTokens: 10,
      outputTokens: 25,
      reasoningTokens: 5,
      totalTokens: 32_000,
    })
    expect(claudeContextUsage({ used: 48_000, size: 200_000 })).toMatchObject({ totalTokens: 48_000 })
    expect(claudeUsage(undefined)).toBeUndefined()
  })

  it("maps tool completion and failure to provider-executed events", () => {
    const state = new Map()
    const complete = [
      ...claudeACPToolEvents(state, toolUpdate({ sessionUpdate: "tool_call", status: "in_progress" })),
      ...claudeACPToolEvents(
        state,
        toolUpdate({ sessionUpdate: "tool_call_update", status: "completed", rawOutput: "README contents" }),
      ),
    ]
    const failed = claudeACPToolEvents(
      new Map(),
      toolUpdate({ sessionUpdate: "tool_call_update", status: "failed", rawOutput: "denied" }),
    )

    expect(complete.map((event) => event.type)).toEqual(["tool-call", "tool-result"])
    expect(complete[0]).toMatchObject({ name: "read", input: { filePath: "README.md" }, providerExecuted: true })
    expect(complete[1]).toMatchObject({
      name: "read",
      providerExecuted: true,
      result: { value: { output: "README contents" } },
    })
    expect(failed.map((event) => event.type)).toEqual(["tool-call", "tool-error"])
  })

  it("maps form choices and typed answers through OpenCode questions", () => {
    const fields = claudeACPElicitationFields({
      mode: "form",
      sessionId: "ses_123",
      message: "Configure report",
      requestedSchema: {
        properties: {
          depth: {
            type: "string",
            title: "Depth",
            oneOf: [
              { title: "Quick", const: "quick" },
              { title: "Deep", const: "deep" },
            ],
          },
          sections: {
            type: "array",
            title: "Sections",
            items: { anyOf: [{ title: "Economy", const: "economy" }] },
          },
          limit: { type: "integer", title: "Limit" },
        },
      },
    })

    expect(fields[0]?.question.options).toEqual([
      { label: "Quick", description: "quick" },
      { label: "Deep", description: "deep" },
    ])
    expect(claudeACPElicitationContent(fields, [["Deep"], ["Economy"], ["3"]])).toEqual({
      depth: "deep",
      sections: ["economy"],
      limit: 3,
    })
  })

  it("maps permission choices, tools, and edit metadata", async () => {
    const asked: Authorization[] = []
    const active = activePermission(async (input) => void asked.push(input))
    expect(
      await requestPermissionForActive(
        active,
        permissionRequest({ kind: "other", title: "Call MCP tool", rawInput: { name: "mcp__server__tool" } }),
      ),
    ).toEqual({ outcome: { outcome: "selected", optionId: "allow" } })
    expect(asked[0]).toMatchObject({ permission: "mcp__server__tool", metadata: { toolName: "mcp__server__tool" } })

    active.tools.set("call_1", {
      name: "glob",
      title: "Find files",
      input: { pattern: "**/*.ts" },
      started: true,
    })
    await requestPermissionForActive(
      active,
      permissionRequest({ kind: "search", title: "Find files", rawInput: { pattern: "**/*.ts" } }),
    )
    expect(asked[1]).toMatchObject({ permission: "glob", metadata: { pattern: "**/*.ts" } })

    await requestPermissionForActive(
      active,
      permissionRequest({ toolCallId: "call_read", kind: "read", rawInput: { file_path: "/tmp/readme.md" } }),
    )
    expect(asked[2]).toMatchObject({ permission: "read", metadata: { filePath: "/tmp/readme.md" } })

    expect(
      await requestPermissionForActive(
        activePermission(async () => {
          throw new PermissionV1.RejectedError()
        }),
        permissionRequest(),
      ),
    ).toEqual({ outcome: { outcome: "selected", optionId: "deny" } })

    await requestPermissionForActive(
      active,
      permissionRequest({
        toolCallId: "call_2",
        kind: "edit",
        title: "Create new-file.txt",
        rawInput: { filePath: "/tmp/new-file.txt" },
        content: [{ type: "diff", path: "/tmp/new-file.txt" } as never],
      }),
    )
    expect(asked[3]).toMatchObject({ permission: "edit", metadata: { filepath: "/tmp/new-file.txt" } })
  })
})

function streamInput(overrides: Partial<StreamInput> = {}): StreamInput {
  return {
    cwd: "/workspace",
    sessionID: SessionID.make("ses_claude_resume"),
    modelID: "claude",
    assistantID: "msg_assistant",
    agent: "build",
    resume: true,
    mcpServers: [{ name: "tools", command: "bun", args: ["server.ts"], env: [] }],
    system: ["Follow OpenCode instructions."],
    messages: [{ role: "user", content: "hello" }],
    abort: new AbortController().signal,
    question: { ask: async () => [] },
    authorize: async () => {},
    ...overrides,
  }
}

function testAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    initialize: async () => ({ protocolVersion: 1 }),
    newSession: async () => ({ sessionId: "test_session", configOptions: [] }),
    resumeSession: async () => ({ configOptions: [] }),
    prompt: async () => ({ stopReason: "end_turn" }),
    cancel: async () => {},
    setSessionConfigOption: async () => ({ configOptions: [] }),
    dispose: async () => {},
    ...overrides,
  }
}

async function collect(input: StreamInput, factory: AgentFactory) {
  return Array.from(await Effect.runPromise(stream(input, factory).pipe(Stream.runCollect)))
}

async function clientIdle(idles: Array<() => void>) {
  while (!idles.length) await Bun.sleep(0)
  idles.shift()?.()
}

function streamState(events: Awaited<ReturnType<typeof collect>>) {
  const event = events.find((item) => item.type === "step-finish")
  return parseState(event?.type === "step-finish" ? event.providerMetadata?.anthropic?.claudeACP : undefined)
}

function sessionUpdate(
  client: ACPClient,
  sessionID: string,
  update: Parameters<ACPClient["sessionUpdate"]>[0]["update"],
) {
  return client.sessionUpdate({ sessionId: sessionID, update })
}

function activePermission(authorize: ActivePermission["authorize"]): ActivePermission {
  return {
    abort: new AbortController().signal,
    tools: new Map(),
    authorize,
  }
}

function permissionRequest(toolCall: Partial<RequestPermissionRequest["toolCall"]> = {}) {
  return {
    sessionId: "claude_session",
    toolCall: {
      toolCallId: "call_1",
      kind: "execute",
      title: "printf hello",
      rawInput: { command: "printf hello" },
      ...toolCall,
    },
    options: [
      { optionId: "allow", kind: "allow_once", name: "Allow" },
      { optionId: "deny", kind: "reject_once", name: "Deny" },
    ],
  } satisfies RequestPermissionRequest
}

function toolUpdate(input: Partial<ToolUpdate> & Pick<ToolUpdate, "sessionUpdate">) {
  return {
    toolCallId: "call_read",
    title: "Read README.md",
    kind: "read",
    rawInput: { filePath: "README.md" },
    _meta: { claudeCode: { toolName: "Read" } },
    ...input,
  } as ToolUpdate
}
