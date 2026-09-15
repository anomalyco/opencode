import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ToolRegistry } from "@/tool/registry"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestConfig } from "../fixture/config"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { MCP } from "@/mcp"
import type { Tool as MCPToolDef } from "@modelcontextprotocol/sdk/types.js"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { InstanceState } from "@/effect/instance-state"
import { Agent } from "@/agent/agent"
import path from "path"

const configLayer = TestConfig.layer({
  directories: () => InstanceState.directory.pipe(Effect.map((dir) => [path.join(dir, ".opencode")])),
})

const root = LayerNode.group([ToolRegistry.node, Agent.node])

// Mock MCP with a browser tool, codemode:false should expose directly without experimental flag
const withMcpDirect = testEffect(
  LayerNode.compile(root, [
    [Config.node, configLayer],
    [RuntimeFlags.node, RuntimeFlags.layer({})],
    [
      MCP.node,
      Layer.mock(MCP.Service, {
        tools: () =>
          Effect.succeed({
            "playwright_browser_navigate": {
              def: {
                name: "browser_navigate",
                description: "navigate browser",
                inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
              } as MCPToolDef,
              client: {} as any,
            },
          }),
        clients: () => Effect.succeed({ playwright: {} as any }),
      }),
    ],
  ]),
)

afterEach(async () => {
  await disposeAllInstances()
})

describe("mcp direct exposure", () => {
  withMcpDirect.instance("exposes playwright tools directly when codemode:false", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const agents = yield* Agent.Service
      const build = yield* agents.get("build")
      if (!build) throw new Error("build agent not found")
      const tools = yield* registry.tools({
        providerID: ProviderV2.ID.opencode,
        modelID: ModelV2.ID.make("test"),
        agent: build,
      })
      const ids = tools.map((t) => t.id)
      console.log("tool ids", ids)
      expect(ids).toContain("playwright_browser_navigate")
    }),
  )
})
