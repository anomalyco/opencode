import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Effect, Layer, Semaphore, Stream } from "effect"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceState } from "@/effect/instance-state"
import { MCP } from "@/mcp"
import { McpCatalog } from "@/mcp/catalog"

export interface Interface {
  readonly reconcile: Effect.Effect<void>
  readonly tools: () => Effect.Effect<Record<string, MCP.McpTool>>
  readonly servers: () => Effect.Effect<string[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/McpTool") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const mcp = yield* MCP.Service
    const events = yield* EventV2Bridge.Service

    const state = yield* InstanceState.make(
      Effect.fn("McpTool.state")(function* (ctx) {
        const lock = Semaphore.makeUnsafe(1)
        const catalog: {
          tools: Record<string, MCP.McpTool>
          servers: string[]
        } = {
          tools: {},
          servers: [],
        }

        const reconcile = lock.withPermit(
          Effect.gen(function* () {
            catalog.tools = yield* mcp.tools()
            catalog.servers = Object.keys(yield* mcp.clients()).map(McpCatalog.sanitize)
          }),
        )

        yield* reconcile
        // Keep this subscriber async: a synchronous listener can deadlock because
        // MCP discovery publishes ToolsChanged while mcp.tools() waits on startup.
        yield* events.subscribe(MCP.ToolsChanged).pipe(
          Stream.filter((event) => !event.location || event.location.directory === ctx.directory),
          Stream.runForEach(() => reconcile),
          Effect.forkScoped({ startImmediately: true }),
        )

        return { catalog, reconcile }
      }),
    )

    return Service.of({
      reconcile: InstanceState.useEffect(state, (s) => s.reconcile),
      tools: Effect.fn("McpTool.tools")(function* () {
        return yield* InstanceState.use(state, (s) => s.catalog.tools)
      }),
      servers: Effect.fn("McpTool.servers")(function* () {
        return yield* InstanceState.use(state, (s) => s.catalog.servers)
      }),
    })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [MCP.node, EventV2Bridge.node],
})

export * as McpTool from "./mcp"
