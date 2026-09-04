import { expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer, Schema } from "effect"
import { Bus } from "@opencode-ai/core/bus"
import { Mcp } from "@opencode-ai/core/mcp/index"
import { Permission } from "@opencode-ai/core/permission"
import { Plugin } from "@opencode-ai/core/plugin"
import { McpTool } from "@opencode-ai/core/tool/mcp"
import { McpToolPlugin } from "@opencode-ai/core/tool/plugin/mcp"
import { Tool } from "@opencode-ai/core/tool"
import { McpEvent } from "@opencode-ai/schema/mcp-event"
import { testEffect } from "./lib/effect"
import { advance, drain } from "./lib/clock"
import { toolDefinitions } from "./lib/tool"
import { PluginTestLayer } from "./plugin/fixture"

const it = testEffect(Layer.merge(PluginTestLayer, McpTool.layer))

it.effect("owns discovery across delayed activation, replacement, and disabling", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const registry = yield* Tool.Service
    const readiness = yield* McpTool.Service
    const mcp = yield* Mcp.Service
    const bus = yield* Bus.Service
    const permission = yield* Permission.Service
    const released = yield* Deferred.make<void>()
    let reads = 0
    let completed = 0
    const definition = (revision: string): Plugin.Generation => ({
      id: McpToolPlugin.Plugin.id,
      revision,
      effect: (ctx) =>
        McpToolPlugin.Plugin.effect(ctx).pipe(
          Effect.provideService(McpTool.Service, readiness),
          Effect.provideService(Bus.Service, bus),
          Effect.provideService(Permission.Service, permission),
          Effect.provideService(Mcp.Service, {
            ...mcp,
            tools: () =>
              Effect.gen(function* () {
                reads++
                yield* Deferred.await(released)
                completed++
                return ["search", "hidden"].map(
                  (name) =>
                    new Mcp.Tool({
                      server: Mcp.ServerName.make("demo"),
                      name,
                      description: "discovered",
                      codemode: false,
                      inputSchema: { type: "object", properties: {} },
                    }),
                )
              }),
          }),
        ),
    })
    const override: Plugin.Generation = {
      id: "override",
      revision: "1",
      effect: (ctx) =>
        ctx.tool
          .transform((editor) => {
            editor.add({
              name: "search",
              options: { namespace: "demo", codemode: false },
              description: "override",
              input: Schema.Struct({}),
              output: Schema.String,
              execute: () => Effect.succeed({ output: "override" }),
            })
            editor.remove("demo_hidden")
          })
          .pipe(Effect.asVoid),
    }

    // Host activation must finish while discovery is still held by a slow server.
    yield* plugins.activate([definition("1"), override])
    yield* plugins.awaitActivation
    yield* advance(() => reads === 1)
    const waiting = yield* Effect.forkScoped(readiness.flush)
    yield* drain
    expect(waiting.pollUnsafe()).toBeUndefined()

    // Replace an activation while its discovery and a session waiter are pending.
    yield* plugins.activate([definition("2"), override])
    yield* Fiber.join(waiting)
    yield* advance(() => reads === 2)
    yield* Deferred.succeed(released, undefined)
    yield* readiness.flush
    expect(completed).toBe(1)
    const snapshot = yield* toolDefinitions(registry)
    expect(snapshot.find((tool) => tool.name === "demo_search")?.description).toBe("override")
    expect(snapshot.some((tool) => tool.name === "demo_hidden")).toBe(false)

    yield* bus.publish(McpEvent.ToolsChanged, { server: "demo" })
    yield* advance(() => reads === 3)
    yield* drain
    expect(reads).toBe(3)
    expect((yield* toolDefinitions(registry)).find((tool) => tool.name === "demo_search")?.description).toBe("override")

    yield* plugins.activate([])
    yield* readiness.flush
    expect((yield* toolDefinitions(registry)).some((tool) => tool.name.startsWith("demo_"))).toBe(false)
    yield* bus.publish(McpEvent.ToolsChanged, { server: "demo" })
    yield* drain
    expect(reads).toBe(3)

    yield* plugins.activate([definition("3")])
    yield* readiness.flush
    expect(reads).toBe(4)
    expect((yield* toolDefinitions(registry)).filter((tool) => tool.name.startsWith("demo_")).length).toBe(2)
    yield* bus.publish(McpEvent.ToolsChanged, { server: "demo" })
    yield* advance(() => reads === 5)
    yield* drain
    expect(reads).toBe(5)
  }),
)
