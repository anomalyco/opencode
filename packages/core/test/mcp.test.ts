import { describe, expect, test } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { MCP } from "@opencode-ai/core/mcp/index"
import { MCPClient } from "@opencode-ai/core/mcp/client"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { SessionV2 } from "@opencode-ai/core/session"
import { McpTool } from "@opencode-ai/core/tool/mcp"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { Deferred, Effect, Fiber, Layer, Stream } from "effect"
import { testEffect } from "./lib/effect"
import { settleTool, toolIdentity, waitForTool } from "./lib/tool"

let assertion: Deferred.Deferred<PermissionV2.AssertInput> | undefined
let decision: Effect.Effect<void, PermissionV2.Error> = Effect.void
let calls = 0

const mcp = Layer.mock(MCP.Service, {
  tools: () =>
    Effect.succeed([
      new MCP.Tool({
        server: MCP.ServerName.make("demo"),
        name: "search",
        description: "Search",
        inputSchema: { type: "object", properties: {} },
      }),
    ]),
  callTool: (input) =>
    Effect.sync(() => {
      calls += 1
      return new MCP.ToolResult({
        server: MCP.ServerName.make(input.server),
        tool: input.name,
        isError: false,
        structured: { ok: true },
        content: [],
      })
    }),
})
const permissions = Layer.mock(PermissionV2.Service, {
  assert: (input) =>
    Effect.gen(function* () {
      if (!assertion) return yield* Effect.die("Permission test is not initialized")
      yield* Deferred.succeed(assertion, input)
      yield* decision
    }),
})
const events = Layer.mock(EventV2.Service, { subscribe: () => Stream.never })
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, McpTool.node]), [
    [MCP.node, mcp],
    [PermissionV2.node, permissions],
    [EventV2.node, events],
    [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
  ]),
)

describe("MCP errors", () => {
  test("expose useful messages", () => {
    expect(new MCP.NotFoundError({ server: MCP.ServerName.make("demo") }).message).toBe("MCP server not found: demo")
    expect(new MCP.ToolCallError({ server: MCP.ServerName.make("demo"), tool: "search", message: "failed" }).message).toBe(
      "failed",
    )
    expect(new MCPClient.NeedsAuthError({ server: "demo" }).message).toBe("MCP server requires authentication: demo")
    expect(new MCPClient.ConnectError({ server: "demo", message: "offline" }).message).toBe("offline")
  })
})

test("MCP tool names match V1 sanitization", () => {
  expect(McpTool.name("context 7", "resolve.library/id")).toBe("context_7_resolve_library_id")
})

it.effect("waits for permission before calling an MCP tool", () =>
  Effect.gen(function* () {
    calls = 0
    assertion = yield* Deferred.make<PermissionV2.AssertInput>()
    const permission = yield* Deferred.make<void>()
    decision = Deferred.await(permission)
    const registry = yield* ToolRegistry.Service
    yield* waitForTool(registry, "execute")

    const fiber = yield* settleTool(registry, {
      sessionID: SessionV2.ID.make("ses_mcp_permission"),
      ...toolIdentity,
      call: {
        type: "tool-call",
        id: "call_mcp_permission",
        name: "execute",
        input: { code: "return await tools.demo.search({})" },
      },
    }).pipe(Effect.forkScoped)
    expect(yield* Deferred.await(assertion)).toEqual({
      action: "demo_search",
      resources: ["*"],
      save: ["*"],
      metadata: {},
      sessionID: SessionV2.ID.make("ses_mcp_permission"),
      agent: toolIdentity.agent,
      source: {
        type: "tool",
        messageID: toolIdentity.assistantMessageID,
        callID: "call_mcp_permission",
      },
    })
    expect(calls).toBe(0)

    yield* Deferred.succeed(permission, undefined)
    yield* Fiber.join(fiber)
    expect(calls).toBe(1)
  }),
)

it.effect("does not call MCP when permission is rejected", () =>
  Effect.gen(function* () {
    calls = 0
    assertion = yield* Deferred.make<PermissionV2.AssertInput>()
    decision = Effect.fail(new PermissionV2.RejectedError())
    const registry = yield* ToolRegistry.Service
    yield* waitForTool(registry, "execute")

    const settlement = yield* settleTool(registry, {
      sessionID: SessionV2.ID.make("ses_mcp_rejected"),
      ...toolIdentity,
      call: {
        type: "tool-call",
        id: "call_mcp_rejected",
        name: "execute",
        input: { code: "return await tools.demo.search({})" },
      },
    })
    expect(settlement.result).toEqual({ type: "text", value: "Unable to execute demo_search" })
    expect(settlement.output?.structured).toEqual({
      toolCalls: [{ tool: "demo.search", status: "error" }],
      error: true,
    })
    expect(calls).toBe(0)
  }),
)
