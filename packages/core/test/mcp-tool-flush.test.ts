import { describe, expect, test } from "bun:test"
import { McpTool } from "@opencode-ai/core/tool/mcp"
import { Tool } from "@opencode-ai/core/tool"
import { Mcp } from "@opencode-ai/core/mcp/index"
import { Bus } from "@opencode-ai/core/bus"
import { Permission } from "@opencode-ai/core/permission"
import { McpEvent } from "@opencode-ai/schema/mcp-event"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Effect, Layer, Stream } from "effect"
import { Image } from "@opencode-ai/core/image"
import { Location } from "@opencode-ai/core/location"
import { testEffect } from "./lib/effect"
import { location } from "./fixture/location"
import { imagePassthrough } from "./lib/image"

const locationLayer = Layer.succeed(Location.Service, Location.Service.of(location({ directory: "/project" })))

describe("MCP tool flush and snapshot", () => {
  testEffect(Layer.empty).effect("flush completes and snapshot is valid", () =>
    Effect.gen(function* () {
      const mcpTool = yield* McpTool.Service
      const registry = yield* Tool.Service

      // Flush initial registration — should complete without hanging
      yield* mcpTool.flush

      // Snapshot should be valid (may be empty if no MCP servers configured)
      const snapshot = yield* registry.snapshot([])
      expect(snapshot.definitions).toBeDefined()
      expect(Array.isArray(snapshot.definitions)).toBe(true)
    }).pipe(
      Effect.provide(
        Layer.fresh(
          AppNodeBuilder.build(LayerNode.group([Tool.node, McpTool.node, Bus.node]), [
            [Mcp.node, Layer.mock(Mcp.Service, {
              tools: () => Effect.succeed([]),
              transform: () => Effect.void,
              callTool: () => Effect.succeed(new Mcp.ToolResult({
                server: Mcp.ServerName.make("test"),
                tool: "test",
                isError: false,
                content: [],
              })),
              servers: () => Effect.succeed([]),
            })],
            [Permission.node, Layer.mock(Permission.Service, { assert: () => Effect.void })],
            [Image.node, imagePassthrough],
            [Location.node, locationLayer],
          ]),
        ),
      ),
    ))

  testEffect(Layer.empty).effect("reload after ToolsChanged updates tool registry", () =>
    Effect.gen(function* () {
      const mcpTool = yield* McpTool.Service
      const registry = yield* Tool.Service
      const bus = yield* Bus.Service

      // Flush initial registration
      yield* mcpTool.flush
      const snapshot1 = yield* registry.snapshot([])
      expect(snapshot1.definitions).toBeDefined()

      // Trigger ToolsChanged — should rebuild state without hanging
      yield* bus.publish(McpEvent.ToolsChanged, { server: "demo" })

      // The Tool state should still be valid after reload
      const snapshot2 = yield* registry.snapshot([])
      expect(snapshot2.definitions).toBeDefined()
    }).pipe(
      Effect.provide(
        Layer.fresh(
          AppNodeBuilder.build(LayerNode.group([Tool.node, McpTool.node, Bus.node]), [
            [Mcp.node, Layer.mock(Mcp.Service, {
              tools: () => Effect.succeed([]),
              transform: () => Effect.void,
              callTool: () => Effect.succeed(new Mcp.ToolResult({
                server: Mcp.ServerName.make("test"),
                tool: "test",
                isError: false,
                content: [],
              })),
              servers: () => Effect.succeed([]),
            })],
            [Permission.node, Layer.mock(Permission.Service, { assert: () => Effect.void })],
            [Image.node, imagePassthrough],
            [Location.node, locationLayer],
          ]),
        ),
      ),
    ))
})
