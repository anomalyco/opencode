import { describe, expect, it } from "bun:test"
import {
  claudeACPAppendOutput,
  claudeACPCompactionStatus,
  claudeACPConfigCommand,
  claudeACPConfigOptionCurrent,
  claudeACPConfigOptionValues,
  claudeACPConfigState,
  claudeACPConnectionKey,
  resolveFastDesired,
  claudeACPDirectPermissionChecks,
  claudeACPElicitationContent,
  claudeACPElicitationFields,
  claudeACPTerminalOutputLimit,
  claudeACPToolEvents,
  requestPermissionForActive,
  resolveACPPath,
  claudeContextUsage,
  claudeUsage,
} from "@/session/llm/claude-acp"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import type { RequestPermissionRequest, SessionNotification } from "@agentclientprotocol/sdk"
import { SessionID } from "../../src/session/schema"
import { Permission } from "@/permission"

describe("Claude ACP compaction status", () => {
  it("recognizes Claude ACP compaction control messages", () => {
    expect(claudeACPCompactionStatus("Compacting...")).toBe("started")
    expect(claudeACPCompactionStatus("\n\nCompacting completed.")).toBe("completed")
    expect(claudeACPCompactionStatus("Compacting failed: too much context")).toBeUndefined()
    expect(claudeACPCompactionStatus("Compacting the answer now.")).toBeUndefined()
  })
})

describe("Claude ACP config slash commands", () => {
  it("parses effort, model, and fast commands", () => {
    expect(claudeACPConfigCommand("/effort max")).toEqual({ configId: "effort", value: "max" })
    expect(claudeACPConfigCommand("/effort")).toEqual({ configId: "effort", value: undefined })
    expect(claudeACPConfigCommand("/model opus")).toEqual({ configId: "model", value: "opus" })
    expect(claudeACPConfigCommand("/fast on")).toEqual({ configId: "fast", value: "on" })
    expect(claudeACPConfigCommand("not a command")).toBeUndefined()
    expect(claudeACPConfigCommand("/compact")).toBeUndefined()
  })

  it("resolves fast mode desired state like Claude Code toggles", () => {
    expect(resolveFastDesired(undefined, undefined)).toBe(true)
    expect(resolveFastDesired(undefined, "off")).toBe(true)
    expect(resolveFastDesired(undefined, "on")).toBe(false)
    expect(resolveFastDesired("on", "off")).toBe(true)
    expect(resolveFastDesired("off", "on")).toBe(false)
    expect(resolveFastDesired("nope", "off")).toBe("invalid")
  })

  it("reads select and boolean config option values", () => {
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
    expect(claudeACPConfigOptionValues({ id: "fast", name: "Fast", type: "boolean", currentValue: false })).toEqual([
      "on",
      "off",
    ])
  })

  it("derives footer state from ACP config options", () => {
    expect(
      claudeACPConfigState([
        {
          id: "effort",
          name: "Effort",
          type: "select",
          currentValue: "high",
          options: [
            { value: "default", name: "Default" },
            { value: "high", name: "High" },
          ],
        },
        {
          id: "fast",
          name: "Fast",
          type: "boolean",
          currentValue: true,
        },
      ]),
    ).toEqual({ effort: "high", fast: true })

    expect(
      claudeACPConfigState([
        {
          id: "effort",
          name: "Effort",
          type: "select",
          currentValue: "default",
          options: [{ value: "default", name: "Default" }],
        },
        {
          id: "fast",
          name: "Fast",
          type: "boolean",
          currentValue: false,
        },
      ]),
    ).toEqual({ effort: "default", fast: false })

    expect(claudeACPConfigState([])).toEqual({})
  })
})

describe("Claude ACP usage", () => {
  it("maps ACP usage into inclusive OpenCode token usage", () => {
    const usage = claudeUsage({
      inputTokens: 100,
      outputTokens: 25,
      cachedReadTokens: 30,
      cachedWriteTokens: 10,
      thoughtTokens: 5,
      totalTokens: 165,
    })

    expect(usage?.inputTokens).toBe(140)
    expect(usage?.nonCachedInputTokens).toBe(100)
    expect(usage?.cacheReadInputTokens).toBe(30)
    expect(usage?.cacheWriteInputTokens).toBe(10)
    expect(usage?.outputTokens).toBe(25)
    expect(usage?.reasoningTokens).toBe(5)
    expect(usage?.totalTokens).toBe(165)
  })

  it("uses ACP context usage as the reported total when available", () => {
    const usage = claudeUsage(
      {
        inputTokens: 100,
        outputTokens: 25,
        cachedReadTokens: 30,
        cachedWriteTokens: 10,
        totalTokens: 165,
      },
      { used: 32_000, size: 1_000_000 },
    )

    expect(usage?.inputTokens).toBe(140)
    expect(usage?.outputTokens).toBe(25)
    expect(usage?.totalTokens).toBe(32_000)
    expect(usage?.providerMetadata?.anthropic).toEqual({
      inputTokens: 100,
      outputTokens: 25,
      cachedReadTokens: 30,
      cachedWriteTokens: 10,
      totalTokens: 165,
      context: { used: 32_000, size: 1_000_000 },
    })
  })

  it("omits usage when Claude ACP does not report it", () => {
    expect(claudeUsage(undefined)).toBeUndefined()
    expect(claudeUsage(null)).toBeUndefined()
  })

  it("creates context-only usage from ACP usage updates", () => {
    const usage = claudeContextUsage({ used: 48_000, size: 200_000 })

    expect(usage?.inputTokens).toBe(0)
    expect(usage?.outputTokens).toBe(0)
    expect(usage?.totalTokens).toBe(48_000)
    expect(usage?.providerMetadata?.anthropic).toEqual({
      context: { used: 48_000, size: 200_000 },
    })
  })
})

describe("Claude ACP connection key", () => {
  it("changes when the agent or system context changes", () => {
    const base = {
      sessionID: SessionID.make("ses_test"),
      cwd: "C:/Users/matt/Projects/opencode",
      modelID: "claude",
      agent: "build",
      mcpServers: [],
      messages: [{ role: "system" as const, content: "Use build instructions" }, { role: "user" as const, content: "hi" }],
    }

    expect(claudeACPConnectionKey(base)).not.toBe(claudeACPConnectionKey({ ...base, agent: "review" }))
    expect(claudeACPConnectionKey(base)).not.toBe(
      claudeACPConnectionKey({
        ...base,
        messages: [
          { role: "system" as const, content: "Use review instructions" },
          { role: "user" as const, content: "hi" },
        ],
      }),
    )
    expect(claudeACPConnectionKey(base)).toBe(
      claudeACPConnectionKey({
        ...base,
        messages: [{ role: "system" as const, content: "Use build instructions" }, { role: "user" as const, content: "next" }],
      }),
    )
  })
})

describe("Claude ACP tool updates", () => {
  it("maps ACP tool completion to provider-executed LLM tool events", () => {
    const state = new Map()
    const events = [
      ...claudeACPToolEvents(state, toolUpdate({ sessionUpdate: "tool_call", status: "in_progress" })),
      ...claudeACPToolEvents(
        state,
        toolUpdate({
          sessionUpdate: "tool_call_update",
          status: "completed",
          rawOutput: { output: "README contents" },
        }),
      ),
    ]

    expect(events.map((event) => event.type)).toEqual(["tool-call", "tool-result"])
    expect(events[0]).toMatchObject({
      type: "tool-call",
      id: "call_read",
      name: "read",
      input: { filePath: "README.md" },
      providerExecuted: true,
    })
    expect(events[1]).toMatchObject({
      type: "tool-result",
      id: "call_read",
      name: "read",
      providerExecuted: true,
      result: {
        type: "json",
        value: {
          title: "Read README.md",
          output: "README contents",
        },
      },
    })
  })

  it("maps ACP tool failures to LLM tool errors", () => {
    const events = [
      ...claudeACPToolEvents(new Map(), toolUpdate({ sessionUpdate: "tool_call_update", status: "failed", rawOutput: "denied" })),
    ]

    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ type: "tool-call", id: "call_read", name: "read", providerExecuted: true })
    expect(events[1]).toMatchObject({ type: "tool-error", id: "call_read", name: "read", message: "denied" })
  })
})

describe("Claude ACP elicitation", () => {
  it("maps ACP form enum choices through OpenCode questions", () => {
    const fields = claudeACPElicitationFields({
      mode: "form",
      sessionId: "ses_123",
      message: "Choose research depth",
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
          includeSources: {
            type: "boolean",
            title: "Include sources",
          },
        },
      },
    })

    expect(fields.map((field) => field.question)).toEqual([
      {
        header: "Depth",
        question: "Depth",
        options: [
          { label: "Quick", description: "quick" },
          { label: "Deep", description: "deep" },
        ],
        custom: false,
      },
      {
        header: "Include sources",
        question: "Include sources",
        options: [
          { label: "Yes", description: "Choose research depth" },
          { label: "No", description: "Choose research depth" },
        ],
        custom: false,
      },
    ])
    expect(claudeACPElicitationContent(fields, [["Deep"], ["Yes"]])).toEqual({
      depth: "deep",
      includeSources: true,
    })
  })

  it("maps ACP multi-select and numeric answers back to content values", () => {
    const fields = claudeACPElicitationFields({
      mode: "form",
      sessionId: "ses_123",
      message: "Configure report",
      requestedSchema: {
        properties: {
          sections: {
            type: "array",
            title: "Sections",
            items: {
              anyOf: [
                { title: "Economy", const: "economy" },
                { title: "Politics", const: "politics" },
              ],
            },
          },
          limit: {
            type: "integer",
            title: "Limit",
          },
        },
      },
    })

    expect(fields[0]?.question.multiple).toBe(true)
    expect(claudeACPElicitationContent(fields, [["Economy", "Politics"], ["3"]])).toEqual({
      sections: ["economy", "politics"],
      limit: 3,
    })
  })
})

describe("Claude ACP permissions", () => {
  it("does not widen one-time OpenCode approval to ACP allow-always", async () => {
    const result = await requestPermissionForActive(
      activePermission({
        ask: async () => "once",
      }),
      permissionRequest([
        { optionId: "always", kind: "allow_always", name: "Always allow" },
        { optionId: "deny", kind: "reject_once", name: "Deny" },
      ]),
    )

    expect(result).toEqual({ outcome: { outcome: "cancelled" } })
  })

  it("keeps OpenCode always approvals as ACP allow-once selections", async () => {
    const result = await requestPermissionForActive(
      activePermission({
        ask: async () => "always",
      }),
      permissionRequest([
        { optionId: "allow", kind: "allow_once", name: "Allow" },
        { optionId: "always", kind: "allow_always", name: "Always allow" },
        { optionId: "deny", kind: "reject_once", name: "Deny" },
      ]),
    )

    expect(result).toEqual({ outcome: { outcome: "selected", optionId: "allow" } })
  })

  it("honors denied rules from the active OpenCode ruleset", async () => {
    const ruleset: PermissionV1.Ruleset = [{ permission: "bash", pattern: "*", action: "deny" }]
    const asked: PermissionV1.AskInput[] = []

    const result = await requestPermissionForActive(
      activePermission({
        ruleset,
        ask: askByRuleset(asked),
      }),
      permissionRequest(),
    )

    expect(result).toEqual({ outcome: { outcome: "selected", optionId: "deny" } })
    expect(asked[0]?.ruleset).toEqual(ruleset)
  })

  it("uses specific unknown ACP tool names so OpenCode rules can deny them", async () => {
    const ruleset: PermissionV1.Ruleset = [{ permission: "mcp__server__tool", pattern: "*", action: "deny" }]
    const asked: PermissionV1.AskInput[] = []

    const result = await requestPermissionForActive(
      activePermission({
        ruleset,
        ask: askByRuleset(asked),
      }),
      unknownToolPermissionRequest(),
    )

    expect(result).toEqual({ outcome: { outcome: "selected", optionId: "deny" } })
    expect(asked[0]?.permission).toBe("mcp__server__tool")
    expect(asked[0]?.patterns).toEqual(["mcp__server__tool"])
  })

  it("preserves explicit ask rules from the active OpenCode ruleset", async () => {
    const ruleset: PermissionV1.Ruleset = [
      { permission: "bash", pattern: "*", action: "deny" },
      { permission: "bash", pattern: "printf hello", action: "ask" },
    ]
    const asked: PermissionV1.AskInput[] = []

    const result = await requestPermissionForActive(
      activePermission({
        ruleset,
        ask: askByRuleset(asked),
      }),
      permissionRequest(),
    )

    expect(result).toEqual({ outcome: { outcome: "selected", optionId: "allow" } })
    expect(asked[0]?.ruleset).toEqual(ruleset)
  })

  it("cancels ACP permission requests when the OpenCode bridge fails before user selection", async () => {
    const abort = new AbortController()

    const result = await requestPermissionForActive(
      {
        sessionID: SessionID.make("ses_test"),
        abort: abort.signal,
        ruleset: [],
        permission: {
          ask: async () => {
            throw new PermissionV1.NotFoundError({ requestID: PermissionV1.ID.make("per_missing") })
          },
          reply: async () => {},
        },
      },
      permissionRequest(),
    )

    expect(result).toEqual({ outcome: { outcome: "cancelled" } })
  })

  it("keeps explicit OpenCode permission rejections as ACP reject selections", async () => {
    const abort = new AbortController()

    const result = await requestPermissionForActive(
      {
        sessionID: SessionID.make("ses_test"),
        abort: abort.signal,
        ruleset: [],
        permission: {
          ask: async () => {
            throw new PermissionV1.RejectedError()
          },
          reply: async () => {},
        },
      },
      permissionRequest(),
    )

    expect(result).toEqual({ outcome: { outcome: "selected", optionId: "deny" } })
  })

  it("still asks for edit permission when Claude sends incomplete diff content", async () => {
    const abort = new AbortController()
    const replies: PermissionV1.AskInput[] = []

    const result = await requestPermissionForActive(
      {
        sessionID: SessionID.make("ses_test"),
        abort: abort.signal,
        ruleset: [],
        permission: {
          ask: async (input) => {
            replies.push(input)
            return "once"
          },
          reply: async () => {},
        },
      },
      editPermissionRequestWithIncompleteDiff(),
    )

    expect(result).toEqual({ outcome: { outcome: "selected", optionId: "allow" } })
    expect(replies).toHaveLength(1)
    expect(replies[0]?.permission).toBe("edit")
    expect(replies[0]?.patterns).toEqual(["C:/Users/matt/new-file.txt"])
  })
})

describe("Claude ACP filesystem", () => {
  it("keeps absolute ACP file paths instead of scoping them under cwd", () => {
    expect(resolveACPPath("C:/Users/matt/Projects/opencode", "C:/Users/matt/acp-permission-test.txt")).toBe(
      "C:\\Users\\matt\\acp-permission-test.txt",
    )
  })

  it("builds direct read permission checks with external directory guardrails", () => {
    expect(
      claudeACPDirectPermissionChecks({
        kind: "read",
        cwd: "C:/Users/matt/Projects/opencode",
        path: "C:/Users/matt/outside/secret.txt",
      }),
    ).toEqual([
      {
        permission: "external_directory",
        patterns: ["C:\\Users\\matt\\outside\\*"],
        always: ["C:\\Users\\matt\\outside\\*"],
        metadata: {
          filepath: "C:\\Users\\matt\\outside\\secret.txt",
          parentDir: "C:\\Users\\matt\\outside",
        },
      },
      {
        permission: "read",
        patterns: ["C:\\Users\\matt\\outside\\secret.txt"],
        always: ["*"],
        metadata: {
          filepath: "C:\\Users\\matt\\outside\\secret.txt",
        },
      },
    ])
  })

  it("builds direct write permission checks before file mutation", () => {
    expect(
      claudeACPDirectPermissionChecks({
        kind: "write",
        cwd: "C:/Users/matt/Projects/opencode",
        path: "src/new-file.ts",
      }),
    ).toEqual([
      {
        permission: "edit",
        patterns: ["src\\new-file.ts"],
        always: ["*"],
        metadata: {
          filepath: "C:\\Users\\matt\\Projects\\opencode\\src\\new-file.ts",
        },
      },
    ])
  })

  it("builds direct terminal permission checks with cwd guardrails", () => {
    expect(
      claudeACPDirectPermissionChecks({
        kind: "terminal",
        cwd: "C:/Users/matt/Projects/opencode",
        command: "node",
        args: ["script.js"],
        terminalCwd: "C:/Users/matt/outside",
      }),
    ).toEqual([
      {
        permission: "external_directory",
        patterns: ["C:\\Users\\matt\\outside\\*"],
        always: ["C:\\Users\\matt\\outside\\*"],
        metadata: {
          filepath: "C:\\Users\\matt\\outside",
          parentDir: "C:\\Users\\matt\\outside",
        },
      },
      {
        permission: "bash",
        patterns: ["node script.js"],
        always: ["node *"],
        metadata: {
          command: "node script.js",
          cwd: "C:\\Users\\matt\\outside",
        },
      },
    ])
  })

  it("builds direct terminal permission checks for external path arguments", () => {
    expect(
      claudeACPDirectPermissionChecks({
        kind: "terminal",
        cwd: "C:/Users/matt/Projects/opencode",
        command: "node",
        args: ["script.js", "C:/Users/matt/outside/secret.txt"],
      }),
    ).toEqual([
      {
        permission: "external_directory",
        patterns: ["C:\\Users\\matt\\outside\\*"],
        always: ["C:\\Users\\matt\\outside\\*"],
        metadata: {
          filepath: "C:\\Users\\matt\\outside\\secret.txt",
          parentDir: "C:\\Users\\matt\\outside",
        },
      },
      {
        permission: "bash",
        patterns: ["node script.js C:/Users/matt/outside/secret.txt"],
        always: ["node *"],
        metadata: {
          command: "node script.js C:/Users/matt/outside/secret.txt",
          cwd: "C:\\Users\\matt\\Projects\\opencode",
        },
      },
    ])
  })
})

describe("Claude ACP terminal output", () => {
  it("clamps output byte limits to a finite range", () => {
    expect(claudeACPTerminalOutputLimit(undefined)).toBe(128_000)
    expect(claudeACPTerminalOutputLimit(Number.NaN)).toBe(128_000)
    expect(claudeACPTerminalOutputLimit(-1)).toBe(0)
    expect(claudeACPTerminalOutputLimit(1_500_000)).toBe(1_000_000)
  })

  it("truncates terminal output by bytes without splitting characters", () => {
    const output = ["aé"]

    expect(claudeACPAppendOutput(output, "b", 2)).toBe(true)
    expect(output.join("")).toBe("b")
    expect(Buffer.byteLength(output.join(""), "utf8")).toBeLessThanOrEqual(2)
  })
})

function activePermission(input: {
  readonly ruleset?: PermissionV1.Ruleset
  readonly ask: (request: PermissionV1.AskInput) => Promise<PermissionV1.Reply>
}) {
  const abort = new AbortController()
  return {
    sessionID: SessionID.make("ses_test"),
    abort: abort.signal,
    ruleset: input.ruleset ?? [],
    permission: {
      ask: input.ask,
      reply: async () => {},
    },
  }
}

function askByRuleset(asked: PermissionV1.AskInput[]) {
  return async (input: PermissionV1.AskInput): Promise<PermissionV1.Reply> => {
    asked.push(input)
    const rules = input.patterns.map((pattern) => Permission.evaluate(input.permission, pattern, input.ruleset))
    if (rules.some((rule) => rule.action === "deny")) throw new PermissionV1.DeniedError({ ruleset: input.ruleset })
    return "once"
  }
}

function permissionRequest(options?: RequestPermissionRequest["options"]) {
  return {
    sessionId: "claude_session",
    toolCall: {
      toolCallId: "call_1",
      kind: "execute",
      title: "printf hello",
      rawInput: { command: "printf hello" },
    },
    options: options ?? [
      { optionId: "allow", kind: "allow_once", name: "Allow" },
      { optionId: "deny", kind: "reject_once", name: "Deny" },
    ],
  } satisfies RequestPermissionRequest
}

function unknownToolPermissionRequest() {
  return {
    sessionId: "claude_session",
    toolCall: {
      toolCallId: "call_mcp",
      kind: "other",
      title: "Call MCP tool",
      rawInput: { name: "mcp__server__tool" },
    },
    options: [
      { optionId: "allow", kind: "allow_once", name: "Allow" },
      { optionId: "deny", kind: "reject_once", name: "Deny" },
    ],
  } satisfies RequestPermissionRequest
}

function editPermissionRequestWithIncompleteDiff() {
  const content = [
    {
      type: "diff",
      path: "C:/Users/matt/new-file.txt",
    } as NonNullable<RequestPermissionRequest["toolCall"]["content"]>[number],
  ]

  return {
    sessionId: "claude_session",
    toolCall: {
      toolCallId: "call_edit",
      kind: "edit",
      title: "Create C:/Users/matt/new-file.txt",
      rawInput: { filePath: "C:/Users/matt/new-file.txt" },
      content,
    },
    options: [
      { optionId: "allow", kind: "allow_once", name: "Allow" },
      { optionId: "deny", kind: "reject_once", name: "Deny" },
    ],
  } satisfies RequestPermissionRequest
}

function toolUpdate(
  input: Partial<Extract<SessionNotification["update"], { sessionUpdate: "tool_call" | "tool_call_update" }>> & {
    sessionUpdate: "tool_call" | "tool_call_update"
  },
) {
  return {
    toolCallId: "call_read",
    title: "Read README.md",
    kind: "read",
    rawInput: { filePath: "README.md" },
    ...input,
  } as Extract<SessionNotification["update"], { sessionUpdate: "tool_call" | "tool_call_update" }>
}
