import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { LLMEvent } from "@opencode-ai/llm"
import { describe, expect, test } from "bun:test"
import { Effect, Fiber, Layer, Schema, Stream } from "effect"
import { Config } from "@/config/config"
import { PermissionAutoApprove } from "@/permission/auto-approve"
import { Provider } from "@/provider/provider"
import { LLM } from "@/session/llm"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { ProviderTest } from "../fake/provider"
import { TestConfig } from "../fixture/config"

const sessionID = SessionID.make("ses_auto_approve")
const callID = "call_auto_approve"

function user(
  text: string,
  options?: { synthetic?: boolean; ignored?: boolean; providerID?: string },
): SessionV1.WithParts {
  const messageID = MessageID.ascending()
  return {
    info: {
      id: messageID,
      sessionID,
      role: "user",
      agent: "build",
      model: {
        providerID: ProviderV2.ID.make(options?.providerID ?? "openai"),
        modelID: ModelV2.ID.make("primary"),
      },
      time: { created: Date.now() },
    },
    parts: [
      {
        id: PartID.ascending(),
        messageID,
        sessionID,
        type: "text",
        text,
        synthetic: options?.synthetic,
        ignored: options?.ignored,
      },
    ],
  }
}

function tool(
  parentID: MessageID,
  id = MessageID.ascending(),
  call = callID,
  state: SessionV1.ToolState = { status: "running", input: {}, time: { start: Date.now() } },
): SessionV1.WithParts {
  return {
    info: {
      id,
      sessionID,
      role: "assistant",
      parentID,
      modelID: ModelV2.ID.make("primary"),
      providerID: ProviderV2.ID.make("openai"),
      mode: "build",
      agent: "build",
      path: { cwd: "/workspace", root: "/workspace" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: Date.now() },
    },
    parts: [
      {
        id: PartID.ascending(),
        messageID: id,
        sessionID,
        type: "tool",
        callID: call,
        tool: "bash",
        state,
      },
    ],
  }
}

function turn(text: string, options?: { providerID?: string; state?: SessionV1.ToolState }) {
  const prompt = user(text, options)
  const anchor = tool(prompt.info.id, MessageID.ascending(), callID, options?.state)
  return { history: [prompt, anchor], tool: { messageID: anchor.info.id, callID } }
}

const defaultTurn = turn("Run git status")

function request(override: Partial<PermissionV1.Request> = {}): PermissionV1.Request {
  return PermissionV1.Request.make({
    id: PermissionV1.ID.ascending(),
    sessionID,
    permission: "bash",
    patterns: ["git status"],
    metadata: { command: "git status" },
    always: [],
    tool: defaultTurn.tool,
    ...override,
  })
}

function response(text: string) {
  return Stream.make(LLMEvent.textDelta({ id: "decision", text }), LLMEvent.finish({ reason: "stop" }))
}

function info(parentID?: SessionID): Session.Info {
  return {
    id: sessionID,
    slug: "auto-approve",
    projectID: ProjectV2.ID.make("project_auto_approve"),
    directory: "/workspace",
    parentID,
    title: "auto approve",
    version: "0.0.0",
    time: { created: Date.now(), updated: Date.now() },
  }
}

function layer(input: {
  history?: SessionV1.WithParts[]
  parentID?: SessionID
  configured?: string
  showDetails?: boolean
  disabled?: boolean
  output?: string
  getModel?: Provider.Interface["getModel"]
  getSmallModel?: Provider.Interface["getSmallModel"]
  stream?: LLM.Interface["stream"]
}) {
  const fake = ProviderTest.fake({
    ...(input.getModel ? { getModel: input.getModel } : {}),
    ...(input.getSmallModel ? { getSmallModel: input.getSmallModel } : {}),
  })
  return LayerNode.compile(PermissionAutoApprove.node, [
    [
      Config.node,
      TestConfig.layer({
        get: () =>
          Effect.succeed(
            input.configured !== undefined || input.showDetails
              ? {
                  experimental: { auto_approve: input.disabled ? false : true },
                  auto_approve: {
                    ...(input.configured !== undefined ? { model: input.configured } : {}),
                    ...(input.showDetails ? { show_details: true } : {}),
                  },
                }
              : { experimental: { auto_approve: input.disabled ? false : true } },
          ),
      }),
    ],
    [Provider.node, fake.layer],
    [
      LLM.node,
      Layer.succeed(
        LLM.Service,
        LLM.Service.of({ stream: input.stream ?? (() => response(input.output ?? "AUTO_APPROVE")) }),
      ),
    ],
    [
      Session.node,
      Layer.mock(Session.Service)({
        get: () => Effect.succeed(info(input.parentID)),
        messages: () => Effect.succeed(input.history ?? defaultTurn.history),
      }),
    ],
  ])
}

function classify(input: Parameters<typeof layer>[0], value = request()) {
  return PermissionAutoApprove.Service.use((service) => service.classify(value)).pipe(
    Effect.provide(layer(input)),
    Effect.runPromise,
  )
}

describe("permission auto-approve parsing", () => {
  const text = LLMEvent.textDelta({ id: "decision", text: "AUTO_APPROVE" })
  const finish = LLMEvent.finish({ reason: "stop" })

  test("accepts only the exact positive protocol with a successful final stop", () => {
    expect(PermissionAutoApprove.approved([text, finish])).toBe(true)
    for (const value of ["", "AUTO_APPROVE\n", "auto_approve", "AUTO_APPROVE ASK", "ASK"]) {
      expect(PermissionAutoApprove.approved([LLMEvent.textDelta({ id: "decision", text: value }), finish])).toBe(false)
    }
    for (const reason of ["length", "content-filter", "unknown", "tool-calls", "error"] as const) {
      expect(PermissionAutoApprove.approved([text, LLMEvent.finish({ reason })])).toBe(false)
    }
    expect(PermissionAutoApprove.approved([text])).toBe(false)
    expect(PermissionAutoApprove.approved([text, finish, finish])).toBe(false)
  })

  test("requires one ordered successful step lifecycle when step events are present", () => {
    expect(
      PermissionAutoApprove.approved([
        LLMEvent.stepStart({ index: 0 }),
        text,
        LLMEvent.stepFinish({ index: 0, reason: "stop" }),
        finish,
      ]),
    ).toBe(true)
    for (const reason of ["length", "content-filter", "unknown", "tool-calls", "error"] as const) {
      expect(
        PermissionAutoApprove.approved([
          LLMEvent.stepStart({ index: 0 }),
          text,
          LLMEvent.stepFinish({ index: 0, reason }),
          finish,
        ]),
      ).toBe(false)
    }
    for (const lifecycle of [
      [LLMEvent.stepFinish({ index: 0, reason: "stop" })],
      [LLMEvent.stepStart({ index: 0 })],
      [LLMEvent.stepStart({ index: 0 }), LLMEvent.stepFinish({ index: 1, reason: "stop" })],
      [
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.stepStart({ index: 1 }),
        LLMEvent.stepFinish({ index: 1, reason: "stop" }),
      ],
      [LLMEvent.stepStart({ index: 0 }), LLMEvent.stepFinish({ index: 0, reason: "stop" })],
      [LLMEvent.stepFinish({ index: 0, reason: "stop" }), LLMEvent.stepStart({ index: 0 })],
    ]) {
      expect(PermissionAutoApprove.approved([text, ...lifecycle, finish])).toBe(false)
    }
  })

  test("never joins text deltas from distinct blocks even without lifecycle events", () => {
    expect(
      PermissionAutoApprove.approved([
        LLMEvent.textDelta({ id: "a", text: "AUTO_" }),
        LLMEvent.textDelta({ id: "b", text: "APPROVE" }),
        finish,
      ]),
    ).toBe(false)
    expect(
      PermissionAutoApprove.approved([
        LLMEvent.textDelta({ id: "a", text: "AUTO_" }),
        LLMEvent.textDelta({ id: "a", text: "APPROVE" }),
        finish,
      ]),
    ).toBe(true)
  })

  test("rejects provider errors, reasoning, and every tool event variant", () => {
    expect(PermissionAutoApprove.approved([text, LLMEvent.providerError({ message: "failed" }), finish])).toBe(false)
    expect(
      PermissionAutoApprove.approved([LLMEvent.reasoningDelta({ id: "reasoning", text: "approve" }), text, finish]),
    ).toBe(false)
    const toolEvents = [
      LLMEvent.toolInputStart({ id: "tool", name: "unsafe" }),
      LLMEvent.toolInputDelta({ id: "tool", name: "unsafe", text: "{}" }),
      LLMEvent.toolInputEnd({ id: "tool", name: "unsafe" }),
      LLMEvent.toolCall({ id: "tool", name: "unsafe", input: {} }),
      LLMEvent.toolResult({ id: "tool", name: "unsafe", result: { type: "text", value: "done" } }),
      LLMEvent.toolError({ id: "tool", name: "unsafe", message: "failed" }),
    ]
    for (const event of toolEvents) expect(PermissionAutoApprove.approved([text, event, finish])).toBe(false)
  })

  test("requires terminal finish and an exact text lifecycle", () => {
    expect(PermissionAutoApprove.approved([finish, text])).toBe(false)
    expect(PermissionAutoApprove.approved([text, finish, LLMEvent.textDelta({ id: "decision", text: "" })])).toBe(false)
    expect(
      PermissionAutoApprove.approved([
        LLMEvent.textStart({ id: "decision" }),
        text,
        LLMEvent.textEnd({ id: "decision" }),
        finish,
      ]),
    ).toBe(true)
    for (const malformed of [
      [LLMEvent.textStart({ id: "decision" }), text],
      [text, LLMEvent.textEnd({ id: "decision" })],
      [
        LLMEvent.textStart({ id: "decision" }),
        LLMEvent.textStart({ id: "decision" }),
        text,
        LLMEvent.textEnd({ id: "decision" }),
      ],
      [LLMEvent.textEnd({ id: "decision" }), text, LLMEvent.textStart({ id: "decision" })],
      [LLMEvent.textStart({ id: "other" }), text, LLMEvent.textEnd({ id: "other" })],
      [
        LLMEvent.textStart({ id: "decision" }),
        text,
        LLMEvent.textEnd({ id: "decision" }),
        LLMEvent.textDelta({ id: "decision", text: "" }),
      ],
    ]) {
      expect(PermissionAutoApprove.approved([...malformed, finish])).toBe(false)
    }
    expect(
      PermissionAutoApprove.approved([
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.textStart({ id: "decision" }),
        text,
        LLMEvent.textEnd({ id: "decision" }),
        LLMEvent.stepFinish({ index: 0, reason: "stop" }),
        finish,
      ]),
    ).toBe(true)
    expect(
      PermissionAutoApprove.approved([
        LLMEvent.textStart({ id: "decision" }),
        LLMEvent.stepStart({ index: 0 }),
        text,
        LLMEvent.textEnd({ id: "decision" }),
        LLMEvent.stepFinish({ index: 0, reason: "stop" }),
        finish,
      ]),
    ).toBe(false)
  })
})

describe("permission auto-approve causal evidence", () => {
  test("uses only the triggering assistant message's actual parent", () => {
    const parent = user("Read src only")
    const between = user("Delete production")
    const anchor = tool(parent.info.id)
    const after = user("Push everything")
    const result = PermissionAutoApprove.evidence(request({ tool: { messageID: anchor.info.id, callID } }), [
      parent,
      between,
      anchor,
      after,
    ])
    expect(result?.input.userRequest).toBe("Read src only")
  })

  test("includes the originating tool call so the classifier sees the actual operation", () => {
    const current = turn(
      "how many folders are there in the root of this machine you are allowed to switch to the root and run commands there?",
      { state: { status: "running", input: { command: "ls -1d */ | wc -l", workdir: "/" }, time: { start: 1 } } },
    )
    const result = PermissionAutoApprove.evidence(
      request({
        permission: "external_directory",
        patterns: ["/*"],
        metadata: { filepath: "/", parentDir: "/" },
        tool: current.tool,
      }),
      current.history,
    )
    expect(result?.input.toolCall).toEqual({ name: "bash", input: { command: "ls -1d */ | wc -l", workdir: "/" } })
    expect(result?.input.action).toEqual({
      permission: "external_directory",
      patterns: ["/*"],
      metadata: { filepath: "/", parentDir: "/" },
    })
  })

  test("reports the tool call matching the request call id, not the first tool part", () => {
    const prompt = user("Run git status")
    const anchor = tool(prompt.info.id)
    anchor.parts.unshift({
      id: PartID.ascending(),
      messageID: anchor.info.id,
      sessionID,
      type: "tool",
      callID: "call_other",
      tool: "read",
      state: { status: "running", input: { filePath: "/etc/shadow" }, time: { start: 1 } },
    })
    const result = PermissionAutoApprove.evidence(request({ tool: { messageID: anchor.info.id, callID } }), [
      prompt,
      anchor,
    ])
    expect(result?.input.toolCall).toEqual({ name: "bash", input: {} })
  })

  test("omits oversized tool input while keeping the tool name", () => {
    const current = turn("Run the generator", {
      state: { status: "running", input: { command: "c".repeat(4_001) }, time: { start: 1 } },
    })
    const result = PermissionAutoApprove.evidence(request({ tool: current.tool }), current.history)
    expect(result?.input.toolCall).toEqual({ name: "bash" })
    expect(JSON.stringify(result?.input)).not.toContain("cccc")

    const inBounds = turn("Run the generator", {
      state: { status: "running", input: { command: "c".repeat(3_000) }, time: { start: 1 } },
    })
    expect(PermissionAutoApprove.evidence(request({ tool: inBounds.tool }), inBounds.history)?.input.toolCall).toEqual({
      name: "bash",
      input: { command: "c".repeat(3_000) },
    })
  })

  test("keeps classifying a near-limit descriptor with a long user request", () => {
    const descriptor = { permission: "bash" as const, patterns: ["run"], metadata: { command: "c".repeat(8_000) } }
    const prompt = "u".repeat(3_800)
    const empty = turn(prompt, { state: { status: "running", input: {}, time: { start: 1 } } })
    const result = PermissionAutoApprove.evidence(request({ ...descriptor, tool: empty.tool }), empty.history)
    expect(result?.input.toolCall).toEqual({ name: "bash", input: {} })
    expect(result?.input.userRequest).toBe(prompt)

    const withToolInput = turn(prompt, {
      state: { status: "running", input: { command: "x".repeat(200) }, time: { start: 1 } },
    })
    const enlarged = PermissionAutoApprove.evidence(
      request({ ...descriptor, tool: withToolInput.tool }),
      withToolInput.history,
    )
    expect(enlarged?.input.toolCall).toEqual({ name: "bash", input: { command: "x".repeat(200) } })
    expect(JSON.stringify(enlarged?.input).length).toBeGreaterThan(12_000)

    const overSizedDescriptor = request({
      permission: "task",
      patterns: ["reviewer"],
      metadata: {
        description: "d".repeat(8_000),
        prompt: "p".repeat(8_000),
        subagent_type: "reviewer",
      },
      tool: empty.tool,
    })
    expect(PermissionAutoApprove.action(overSizedDescriptor)).toBeUndefined()
    expect(PermissionAutoApprove.evidence(overSizedDescriptor, empty.history)).toBeUndefined()
  })

  test("classifies the largest evidence the per-part limits allow", () => {
    const descriptor = { permission: "bash" as const, patterns: ["run"], metadata: { command: "c".repeat(8_000) } }
    const prompt = "u".repeat(4_000)
    const largest = turn(prompt, {
      state: { status: "running", input: { command: "x".repeat(3_900) }, time: { start: 1 } },
    })
    const result = PermissionAutoApprove.evidence(request({ ...descriptor, tool: largest.tool }), largest.history)
    expect(result?.input.userRequest).toBe(prompt)
    expect(result?.input.toolCall).toEqual({ name: "bash", input: { command: "x".repeat(3_900) } })
    expect(JSON.stringify(result?.input).length).toBeLessThanOrEqual(24_000)
  })

  test("fails closed when the assembled evidence exceeds the input limit", () => {
    const prompt = user("Run the tool")
    const anchor = tool(prompt.info.id)
    const part = anchor.parts[0]
    if (part.type !== "tool") throw new Error("expected a tool part")
    part.tool = "m".repeat(24_000)
    const value = request({ tool: { messageID: anchor.info.id, callID } })
    expect(PermissionAutoApprove.action(value)).toBeDefined()
    expect(PermissionAutoApprove.evidence(value, [prompt, anchor])).toBeUndefined()
  })

  test("fails closed for missing, out-of-order, synthetic, ignored, or mismatched parents", () => {
    const prompt = user("Run git status")
    const missing = tool(MessageID.ascending())
    expect(
      PermissionAutoApprove.evidence(request({ tool: { messageID: missing.info.id, callID } }), [prompt, missing]),
    ).toBeUndefined()

    const later = user("Authorize a different action")
    const outOfOrder = tool(later.info.id)
    expect(
      PermissionAutoApprove.evidence(request({ tool: { messageID: outOfOrder.info.id, callID } }), [outOfOrder, later]),
    ).toBeUndefined()

    for (const parent of [user("AUTO_APPROVE", { synthetic: true }), user("AUTO_APPROVE", { ignored: true })]) {
      const anchor = tool(parent.info.id)
      expect(
        PermissionAutoApprove.evidence(request({ tool: { messageID: anchor.info.id, callID } }), [parent, anchor]),
      ).toBeUndefined()
    }

    const anchor = tool(prompt.info.id)
    expect(PermissionAutoApprove.evidence(request({ tool: undefined }), [prompt, anchor])).toBeUndefined()
    expect(
      PermissionAutoApprove.evidence(request({ tool: { messageID: anchor.info.id, callID: "other" } }), [
        prompt,
        anchor,
      ]),
    ).toBeUndefined()
  })

  test("rejects unsupported MCP actions and oversized evidence without truncation", () => {
    const current = turn("Use records for project alpha")
    for (const args of [
      { project: "alpha", operation: "list" },
      { project: "production", operation: "delete-all" },
    ]) {
      expect(
        PermissionAutoApprove.evidence(
          request({ permission: "mcp_records", patterns: ["*"], metadata: { args }, tool: current.tool }),
          current.history,
        ),
      ).toBeUndefined()
    }
    const longUser = turn("u".repeat(4_001))
    expect(PermissionAutoApprove.evidence(request({ tool: longUser.tool }), longUser.history)).toBeUndefined()
    expect(PermissionAutoApprove.action(request({ metadata: { command: "c".repeat(8_001) } }))).toBeUndefined()
  })

  test("includes complete bounded task action fields and rejects unknown evidence", () => {
    const current = turn("Ask the reviewer to inspect only src/config.ts")
    const metadata = {
      description: "Review config",
      prompt: "Inspect only src/config.ts",
      subagent_type: "reviewer",
      background: true,
      task_id: "task_existing",
      command: "/review",
    }
    const input = request({ permission: "task", patterns: ["reviewer"], metadata, tool: current.tool })
    const result = PermissionAutoApprove.evidence(input, current.history)
    expect(result?.input.action.metadata).toEqual({
      description: "Review config",
      prompt: "Inspect only src/config.ts",
      subagent_type: "reviewer",
      background: true,
      task_id: "task_existing",
      command: "/review",
    })
    expect(
      PermissionAutoApprove.action(request({ ...input, metadata: { ...metadata, credential: "do-not-copy" } })),
    ).toBeUndefined()
  })

  test("ignores duplicate edit rendering metadata and rejects other unknown fields", () => {
    const input = request({
      permission: "edit",
      patterns: ["src/index.ts"],
      metadata: {
        filepath: "src/index.ts",
        diff: "-old\n+new",
        files: [{ filePath: "src/index.ts", patch: "-old\n+new" }],
      },
    })
    expect(PermissionAutoApprove.action(input)).toEqual({
      permission: "edit",
      patterns: ["src/index.ts"],
      metadata: { filepath: "src/index.ts", diff: "-old\n+new" },
    })
    expect(
      PermissionAutoApprove.action(request({ ...input, metadata: { ...input.metadata, extra: true } })),
    ).toBeUndefined()
    expect(
      PermissionAutoApprove.action(
        request({
          ...input,
          metadata: {
            ...input.metadata,
            files: [{ filePath: "src/index.ts", movePath: ".github/workflows/release.yml" }],
          },
        }),
      ),
    ).toBeUndefined()
  })

  test("preserves exact read bounds", () => {
    expect(
      PermissionAutoApprove.action(
        request({ permission: "read", patterns: ["src/index.ts"], metadata: { offset: 5, limit: 20 } }),
      ),
    ).toEqual({
      permission: "read",
      patterns: ["src/index.ts"],
      metadata: { offset: 5, limit: 20 },
    })
    for (const metadata of [{}, { offset: 0, limit: 20 }, { offset: 5, limit: 0 }]) {
      expect(
        PermissionAutoApprove.action(request({ permission: "read", patterns: ["src/index.ts"], metadata })),
      ).toBeUndefined()
    }
  })

  test("requires complete operation-specific LSP evidence", () => {
    expect(
      PermissionAutoApprove.action(
        request({ permission: "lsp", patterns: ["*"], metadata: { operation: "workspaceSymbol", query: "" } }),
      ),
    ).toBeDefined()
    expect(
      PermissionAutoApprove.action(
        request({ permission: "lsp", patterns: ["*"], metadata: { operation: "workspaceSymbol" } }),
      ),
    ).toBeUndefined()
    expect(
      PermissionAutoApprove.action(
        request({
          permission: "lsp",
          patterns: ["*"],
          metadata: { operation: "documentSymbol", filePath: "/workspace/src/index.ts" },
        }),
      ),
    ).toBeDefined()
    expect(
      PermissionAutoApprove.action(
        request({ permission: "lsp", patterns: ["*"], metadata: { operation: "documentSymbol" } }),
      ),
    ).toBeUndefined()

    for (const operation of [
      "goToDefinition",
      "findReferences",
      "hover",
      "goToImplementation",
      "prepareCallHierarchy",
      "incomingCalls",
      "outgoingCalls",
    ]) {
      const complete = {
        operation,
        filePath: "/workspace/src/index.ts",
        line: 3,
        character: 7,
      }
      expect(
        PermissionAutoApprove.action(request({ permission: "lsp", patterns: ["*"], metadata: complete })),
      ).toBeDefined()
      for (const missing of ["filePath", "line", "character"] as const) {
        expect(
          PermissionAutoApprove.action(
            request({
              permission: "lsp",
              patterns: ["*"],
              metadata: Object.fromEntries(Object.entries(complete).filter(([key]) => key !== missing)),
            }),
          ),
        ).toBeUndefined()
      }
    }
    expect(
      PermissionAutoApprove.action(request({ permission: "lsp", patterns: ["*"], metadata: { operation: "unknown" } })),
    ).toBeUndefined()
  })

  test("rejects incomplete external-directory and MCP-read evidence", () => {
    expect(
      PermissionAutoApprove.action(
        request({ permission: "external_directory", patterns: ["/tmp/*"], metadata: { command: "ls /tmp" } }),
      ),
    ).toBeUndefined()
    expect(
      PermissionAutoApprove.action(
        request({ permission: "external_directory", patterns: ["/tmp/*"], metadata: { filepath: "/tmp/a" } }),
      ),
    ).toBeUndefined()
    expect(
      PermissionAutoApprove.action(
        request({ permission: "read", patterns: ["mcp:server:item"], metadata: { server: "server" } }),
      ),
    ).toBeUndefined()
  })
})

describe("permission auto-approve model execution", () => {
  test("uses the configured model and sends the bounded non-agentic request", async () => {
    const model = ProviderTest.model({
      id: ModelV2.ID.make("classifier"),
      providerID: ProviderV2.ID.make("dedicated"),
    })
    let fallback = 0
    let streamInput: Parameters<LLM.Interface["stream"]>[0] | undefined
    expect(
      await classify({
        configured: "dedicated/classifier",
        showDetails: true,
        getModel: () => Effect.succeed(model),
        getSmallModel: () => {
          fallback++
          return Effect.succeed(undefined)
        },
        stream: (input) => {
          streamInput = input
          return response("AUTO_APPROVE")
        },
      }),
    ).toEqual({
      approved: true,
      details: {
        input: JSON.stringify({
          userRequest: "Run git status",
          toolCall: { name: "bash", input: {} },
          action: { permission: "bash", patterns: ["git status"], metadata: { command: "git status" } },
        }),
        output: "AUTO_APPROVE",
      },
    })
    expect(fallback).toBe(0)
    expect(streamInput?.tools).toEqual({})
    expect(streamInput?.toolChoice).toBe("none")
    expect(streamInput?.retries).toBe(0)
    expect(streamInput?.maxOutputTokens).toBe(512)
    expect(streamInput?.agent.prompt).toBe(PermissionAutoApprove.policy)
  })

  test("uses only the causal parent provider's small model", async () => {
    const current = turn("List files", { providerID: "session-provider" })
    const providers: string[] = []
    expect(
      await classify(
        {
          history: current.history,
          getSmallModel: (providerID) => {
            providers.push(providerID)
            return Effect.succeed(ProviderTest.model({ providerID }))
          },
        },
        request({ tool: current.tool }),
      ),
    ).toEqual({ approved: true })
    expect(providers).toEqual(["session-provider"])
  })

  test("shows a negative raw output only when details are enabled", async () => {
    expect(await classify({ output: "ASK" })).toEqual({ approved: false })
    expect(await classify({ output: "ASK", showDetails: true })).toEqual({
      approved: false,
      details: {
        input: JSON.stringify({
          userRequest: "Run git status",
          toolCall: { name: "bash", input: {} },
          action: { permission: "bash", patterns: ["git status"], metadata: { command: "git status" } },
        }),
        output: "ASK",
      },
    })
  })

  test("surfaces classifier failures in details when enabled", async () => {
    expect(
      await classify({
        showDetails: true,
        parentID: SessionID.make("ses_auto_approve_parent"),
      }),
    ).toEqual({
      approved: false,
      details: { input: "", output: "(unavailable: subagent_session)" },
    })
    expect(await classify({ showDetails: true }, request({ tool: undefined }))).toEqual({
      approved: false,
      details: { input: "", output: "(unavailable: not_classifiable)" },
    })
    expect(
      await classify({
        showDetails: true,
        configured: "provider/",
      }),
    ).toEqual({
      approved: false,
      details: { input: "", output: "(unavailable: invalid_configured_model)" },
    })
    expect(
      await classify({
        showDetails: true,
        getSmallModel: () => Effect.succeed(undefined),
      }),
    ).toEqual({
      approved: false,
      details: { input: "", output: "(unavailable: model_unavailable)" },
    })
    expect(
      await classify({
        showDetails: true,
        stream: () => Stream.fail(new Error("provider rejected")),
      }),
    ).toEqual({
      approved: false,
      details: { input: "", output: "(failed: model_or_context_error)" },
    })
  })

  test("surfaces the classification deadline in details when enabled", async () => {
    expect(await classify({ showDetails: true, stream: () => Stream.never })).toEqual({
      approved: false,
      details: { input: "", output: "(failed: timeout)" },
    })
  }, 20_000)

  test("coalesces concurrent classification for the same pending request", async () => {
    let streams = 0
    const value = request()
    const result = await PermissionAutoApprove.Service.use((service) =>
      Effect.all([service.classify(value), service.classify(value)], { concurrency: "unbounded" }),
    ).pipe(
      Effect.provide(
        layer({
          stream: () => {
            streams++
            return Stream.fromEffect(Effect.sleep("10 millis")).pipe(Stream.flatMap(() => response("AUTO_APPROVE")))
          },
        }),
      ),
      Effect.runPromise,
    )
    expect(result).toEqual([{ approved: true }, { approved: true }])
    expect(streams).toBe(1)
  })

  test("rejects invalid explicit model syntax without fallback", async () => {
    const decode = Schema.decodeUnknownSync(ConfigV1.Info)
    expect(decode({ auto_approve: { model: "provider/model" } }).auto_approve?.model).toBe("provider/model")
    expect(decode({ auto_approve: { show_details: true } }).auto_approve?.show_details).toBe(true)
    for (const configured of ["", "provider", "/model", "provider/", "   ", "provider / model"]) {
      let fallback = 0
      expect(
        await classify({
          configured,
          getSmallModel: () => {
            fallback++
            return Effect.succeed(ProviderTest.model())
          },
        }),
      ).toEqual({ approved: false })
      expect(fallback).toBe(0)
      expect(decode({ auto_approve: { model: configured } }).auto_approve?.model).toBe(configured)
    }
  })

  test("distinguishes a cross-provider small model from a missing one", async () => {
    const current = turn("List files", { providerID: "session-provider" })
    expect(
      await classify(
        {
          history: current.history,
          showDetails: true,
          getSmallModel: () => Effect.succeed(ProviderTest.model({ providerID: ProviderV2.ID.make("other") })),
        },
        request({ tool: current.tool }),
      ),
    ).toEqual({
      approved: false,
      details: { input: "", output: "(unavailable: model_provider_mismatch)" },
    })
    expect(
      await classify({
        showDetails: true,
        getSmallModel: () => Effect.succeed(undefined),
      }),
    ).toEqual({
      approved: false,
      details: { input: "", output: "(unavailable: model_unavailable)" },
    })
  })

  test("explains a verdict rejected for reasoning output", async () => {
    const model = ProviderTest.model({
      id: ModelV2.ID.make("classifier"),
      providerID: ProviderV2.ID.make("dedicated"),
    })
    const result = await classify({
      configured: "dedicated/classifier",
      showDetails: true,
      getModel: () => Effect.succeed(model),
      stream: () =>
        Stream.make(
          LLMEvent.reasoningDelta({ id: "reasoning", text: "thinking" }),
          LLMEvent.textDelta({ id: "decision", text: "AUTO_APPROVE" }),
          LLMEvent.finish({ reason: "stop" }),
        ),
    })
    expect(result.approved).toBe(false)
    expect(result.details?.output).toBe("(rejected: reasoning_output) AUTO_APPROVE")
  })

  test("refuses classification unless the beta flag is enabled", async () => {
    let streamed = false
    const stream = () => {
      streamed = true
      return response("AUTO_APPROVE")
    }
    expect(await classify({ disabled: true, stream })).toEqual({ approved: false })
    expect(streamed).toBe(false)
    expect(await classify({ disabled: true, showDetails: true, stream })).toEqual({
      approved: false,
      details: { input: "", output: "(unavailable: disabled)" },
    })
    expect(streamed).toBe(false)
    expect(await classify({ stream })).toEqual({ approved: true })
    expect(streamed).toBe(true)
  })

  test("refuses classification for child sessions without a model call", async () => {
    let streamed = false
    expect(
      await classify({
        parentID: SessionID.make("ses_auto_approve_parent"),
        stream: () => {
          streamed = true
          return response("AUTO_APPROVE")
        },
      }),
    ).toEqual({ approved: false })
    expect(streamed).toBe(false)
  })

  test("resolves waiters when the leading classification is interrupted", async () => {
    const value = request()
    expect(
      await PermissionAutoApprove.Service.use((service) =>
        Effect.gen(function* () {
          const leader = yield* service.classify(value).pipe(Effect.forkChild)
          yield* Effect.sleep("10 millis")
          const waiter = yield* service.classify(value).pipe(Effect.forkChild)
          yield* Effect.sleep("10 millis")
          yield* Fiber.interrupt(leader)
          return yield* Fiber.join(waiter).pipe(
            Effect.timeoutOrElse({ duration: "2 seconds", orElse: () => Effect.succeed({ approved: true }) }),
          )
        }),
      ).pipe(Effect.provide(layer({ stream: () => Stream.never })), Effect.runPromise),
    ).toEqual({ approved: false })
  }, 7_000)

  test("caches the decision for the lifetime of the pending request", async () => {
    let streams = 0
    const value = request()
    expect(
      await PermissionAutoApprove.Service.use((service) =>
        Effect.all([service.classify(value), service.classify(value)]),
      ).pipe(
        Effect.provide(
          layer({
            stream: () => {
              streams++
              return response("AUTO_APPROVE")
            },
          }),
        ),
        Effect.runPromise,
      ),
    ).toEqual([{ approved: true }, { approved: true }])
    expect(streams).toBe(1)
  })

  test("fails closed for unavailable, cross-provider, lookup, and stream failures", async () => {
    let streamed = false
    expect(
      await classify({
        getSmallModel: () => Effect.succeed(undefined),
        stream: () => {
          streamed = true
          return response("AUTO_APPROVE")
        },
      }),
    ).toEqual({ approved: false })
    expect(streamed).toBe(false)

    const current = turn("List files", { providerID: "session-provider" })
    expect(
      await classify(
        {
          history: current.history,
          getSmallModel: () => Effect.succeed(ProviderTest.model({ providerID: ProviderV2.ID.make("other") })),
        },
        request({ tool: current.tool }),
      ),
    ).toEqual({ approved: false })
    expect(await classify({ configured: "missing/model", getModel: () => Effect.die(new Error("missing")) })).toEqual({
      approved: false,
    })
    expect(await classify({ stream: () => Stream.fail(new Error("provider rejected")) })).toEqual({ approved: false })
  })

  test("fails closed when classification exceeds its deadline", async () => {
    expect(await classify({ stream: () => Stream.never })).toEqual({ approved: false })
  }, 20_000)
})
