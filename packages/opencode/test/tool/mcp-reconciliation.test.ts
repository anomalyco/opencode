import { afterEach, describe, expect } from "bun:test"
import path from "path"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceState } from "@/effect/instance-state"
import { MCP } from "@/mcp"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { McpTool } from "@/tool/mcp"
import { ToolRegistry } from "@/tool/registry"
import { TestConfig } from "../fixture/config"
import { disposeAllInstances } from "../fixture/fixture"
import { it } from "../lib/effect"
import { Deferred, Effect, Fiber, Layer } from "effect"
import type { Tool as MCPToolDef } from "@modelcontextprotocol/sdk/types.js"

const configLayer = TestConfig.layer({
  directories: () => InstanceState.directory.pipe(Effect.map((dir) => [path.join(dir, ".opencode")])),
})

const root = LayerNode.group([ToolRegistry.node, McpTool.node, Agent.node, EventV2Bridge.node])

afterEach(async () => {
  await disposeAllInstances()
})

function hasVoiceCatalog(tools: { id: string; description: string }[]) {
  return tools.some((tool) => tool.id === "execute" && tool.description.includes("tools.voice.list_open_tabs"))
}

describe("mcp tool reconciliation", () => {
  it.instance("explicitly fences asynchronous MCP tool reconciliation", () =>
    Effect.gen(function* () {
      const initialRead = yield* Deferred.make<void>()
      const reconcileStarted = yield* Deferred.make<void>()
      const releaseReconcile = yield* Deferred.make<void>()
      let reads = 0
      let catalog: Record<string, MCP.McpTool> = {}
      let clients: Record<string, MCP.McpTool["client"]> = {}

      const layer = LayerNode.compile(root, [
        [Config.node, configLayer],
        [RuntimeFlags.node, RuntimeFlags.layer({ experimentalCodeMode: true })],
        [
          MCP.node,
          Layer.mock(MCP.Service, {
            tools: () =>
              Effect.gen(function* () {
                reads += 1
                if (reads === 1) {
                  yield* Deferred.succeed(initialRead, undefined)
                  return catalog
                }
                yield* Deferred.succeed(reconcileStarted, undefined)
                yield* Deferred.await(releaseReconcile)
                return catalog
              }),
            clients: () => Effect.succeed(clients),
          }),
        ],
      ])

      yield* Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const adapter = yield* McpTool.Service
        const events = yield* EventV2Bridge.Service
        const agents = yield* Agent.Service
        yield* adapter.tools()
        yield* Deferred.await(initialRead)

        catalog = {
          voice_list_open_tabs: {
            def: {
              name: "list_open_tabs",
              description: "list open tabs",
              inputSchema: { type: "object", properties: {} },
            } as MCPToolDef,
            client: {} as MCP.McpTool["client"],
          },
        }
        clients = { voice: {} as MCP.McpTool["client"] }

        yield* events.publish(MCP.ToolsChanged, { server: "voice" })
        yield* Deferred.await(reconcileStarted)

        const query = {
          providerID: ProviderV2.ID.opencode,
          modelID: ModelV2.ID.make("test"),
          agent: yield* agents.defaultInfo(),
        }
        expect(hasVoiceCatalog(yield* registry.tools(query))).toBe(false)

        const fence = yield* Effect.forkChild(adapter.reconcile, { startImmediately: true })
        expect(fence.pollUnsafe()).toBeUndefined()
        yield* Deferred.succeed(releaseReconcile, undefined)
        yield* Fiber.join(fence)
        expect(hasVoiceCatalog(yield* registry.tools(query))).toBe(true)
      }).pipe(Effect.provide(layer))
    }),
  )
})
