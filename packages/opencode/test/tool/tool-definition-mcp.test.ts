import { describe, expect, beforeEach } from "bun:test"
import { Effect, Layer } from "effect"
import { dynamicTool, jsonSchema } from "ai"
import { testEffect } from "../lib/effect"
import { SessionTools } from "@/session/tools"
import { MCP } from "@/mcp"
import { Plugin } from "@/plugin"
import { ToolRegistry } from "@/tool/registry"
import { Permission } from "@/permission"
import { Truncate } from "@/tool/truncate"
import { ProviderTest } from "../fake/provider"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { SessionID, MessageID } from "@/session/schema"
import { ProjectV2 } from "@opencode-ai/core/project"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import type { TaskPromptOps } from "@/tool/task"

// --- Mutable capture array shared between the mock plugin layer and test body ---
const captured = { calls: [] as Array<{ toolID: string; description: string }> }

// --- Plugin layer that records tool.definition invocations ---
const pluginLayer = Layer.succeed(
  Plugin.Service,
  Plugin.Service.of({
    init: () => Effect.void,
    list: () => Effect.succeed([]),
    trigger: ((name: string, input: any, output: any) => {
      if (name === "tool.definition") {
        captured.calls.push({ toolID: input.toolID, description: output.description })
      }
      return Effect.succeed(output)
    }) as Plugin.Interface["trigger"],
  }),
)

// --- MCP layer returning a single known tool ---
const mcpLayer = Layer.mock(MCP.Service, {
  tools: () =>
    Effect.succeed({
      "test_mcp_tool_v2": dynamicTool({
        description: "Original MCP tool description",
        inputSchema: jsonSchema({ type: "object", properties: {} }),
        execute: async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
      }),
    }),
})

// --- Registry returning no tools (focus is the MCP path) ---
const registryLayer = Layer.mock(ToolRegistry.Service, {
  tools: () => Effect.succeed([]),
})

// --- Permission mock (ask is never called during resolve) ---
const permissionLayer = Layer.mock(Permission.Service, {
  ask: () => Effect.void,
})

// --- Truncate mock (output is never called during resolve) ---
const truncateLayer = Layer.mock(Truncate.Service, {
  output: () => Effect.succeed({ content: "", truncated: false as const }),
  limits: () => Effect.succeed({ maxLines: 2000, maxBytes: 50000 }),
})

// Compose all mock layers
const testLayer = Layer.mergeAll(pluginLayer, mcpLayer, registryLayer, permissionLayer, truncateLayer)

const it = testEffect(testLayer)

// --- Minimal resolve input fields (closures capture these but don't run during resolve) ---
const testSession = {
  id: SessionID.make("ses_test"),
  slug: "test",
  projectID: "test" as ProjectV2.ID,
  directory: "",
  title: "Test Session",
  version: "1.0",
  time: { created: 0, updated: 0 },
} satisfies Parameters<typeof SessionTools.resolve>[0]["session"]

const testProcessor = {
  message: (({ id: "msg_test" as MessageID }) as unknown) as SessionV1.Assistant,
  updateToolCall: () => Effect.succeed(undefined as any),
  completeToolCall: () => Effect.void,
}

const testPromptOps: TaskPromptOps = {
  cancel: () => Effect.void,
  resolvePromptParts: () => Effect.succeed([]),
  prompt: () => Effect.succeed({} as any),
}

describe("tool.definition MCP hook", () => {
  beforeEach(() => {
    captured.calls = []
  })

  it.instance("fires tool.definition hook for MCP tools during resolve", () =>
    Effect.gen(function* () {
      const tools = yield* SessionTools.resolve({
        agent: {
          name: "test",
          mode: "primary" as const,
          options: {},
          permission: [
            { action: "allow", permission: "*", pattern: "*" },
          ] as PermissionV1.Rule[],
        },
        model: ProviderTest.model(),
        session: testSession,
        processor: testProcessor,
        bypassAgentCheck: false,
        messages: [],
        promptOps: testPromptOps,
      })

      // The hook must have been called exactly once — for our MCP tool
      expect(captured.calls.length).toBe(1)
      expect(captured.calls[0].toolID).toBe("test_mcp_tool_v2")
      expect(captured.calls[0].description).toBe("Original MCP tool description")

      // The tool must appear in the returned map
      expect(tools["test_mcp_tool_v2"]).toBeDefined()
    }),
  )

  it.instance("plugin can modify MCP tool description via tool.definition hook", () =>
    Effect.gen(function* () {
      const modifyingPlugin = Plugin.Service.of({
        init: () => Effect.void,
        list: () => Effect.succeed([]),
        trigger: ((_name: string, _input: any, output: any) => {
          output.description = "PREFIX: " + output.description
          return Effect.succeed(output)
        }) as Plugin.Interface["trigger"],
      })

      const tools = yield* SessionTools.resolve({
        agent: {
          name: "test",
          mode: "primary" as const,
          options: {},
          permission: [
            { action: "allow", permission: "*", pattern: "*" },
          ] as PermissionV1.Rule[],
        },
        model: ProviderTest.model(),
        session: testSession,
        processor: testProcessor,
        bypassAgentCheck: false,
        messages: [],
        promptOps: testPromptOps,
      }).pipe(Effect.provideService(Plugin.Service, modifyingPlugin))

      const tool = tools["test_mcp_tool_v2"]
      expect(tool).toBeDefined()
      expect(tool!.description).toBe("PREFIX: Original MCP tool description")
    }),
  )
})
