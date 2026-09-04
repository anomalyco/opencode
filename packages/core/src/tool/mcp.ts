export * as McpTool from "./mcp.js"

import { Context, Effect, Fiber, Layer, Scope } from "effect"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"

/** Registry namespace and permission action names for MCP tools. */
export const namespace = (server: string) => server.replace(/[^a-zA-Z0-9_-]/g, "_")
export const name = (server: string, tool: string) => `${namespace(server)}_${tool.replace(/[^a-zA-Z0-9_-]/g, "_")}`

export interface Interface {
  /** Wait for the active plugin's initial discovery; disabled plugins have nothing to await. */
  readonly flush: Effect.Effect<void>
  readonly start: (discovery: Effect.Effect<void>) => Effect.Effect<void, never, Scope.Scope>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/McpTool") {}

export const layer = Layer.effect(
  Service,
  Effect.sync(() => {
    let pending = Effect.void
    return Service.of({
      flush: Effect.suspend(() => pending),
      start: (discovery) =>
        Effect.gen(function* () {
          const fiber = yield* Effect.forkScoped(discovery)
          const wait = Effect.asVoid(Fiber.await(fiber))
          yield* Effect.acquireRelease(
            Effect.sync(() => (pending = wait)),
            () =>
              Effect.sync(() => {
                if (pending === wait) pending = Effect.void
              }),
          )
        }),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [] })
