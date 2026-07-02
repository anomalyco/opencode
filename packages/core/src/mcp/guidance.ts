export * as McpGuidance from "./guidance"

import { makeLocationNode } from "../effect/app-node"
import { Context, Effect, Layer, Schema } from "effect"
import { AgentV2 } from "../agent"
import { PermissionV2 } from "../permission"
import { McpTool } from "../tool/mcp"
import { MCP } from "./index"
import { SystemContext } from "../system-context/index"

const Summary = Schema.Struct({
  server: Schema.String,
  instructions: Schema.String,
})
type Summary = typeof Summary.Type

const entries = (servers: ReadonlyArray<Summary>) =>
  servers.flatMap((server) => [
    `  <server name="${server.server}">`,
    ...server.instructions.split("\n").map((line) => `    ${line}`),
    "  </server>",
  ])

const render = (servers: ReadonlyArray<Summary>) =>
  ["<mcp_instructions>", ...entries(servers), "</mcp_instructions>"].join("\n")

const update = (previous: ReadonlyArray<Summary>, current: ReadonlyArray<Summary>) => {
  const diff = SystemContext.diffByKey(
    previous,
    current,
    (server) => server.server,
    (before, after) => before.instructions !== after.instructions,
  )
  // Additions and removals render as small deltas; anything else restates the full list.
  if (diff.changed.length > 0 || (diff.added.length === 0 && diff.removed.length === 0))
    return [
      "The available MCP server instructions have changed. This list supersedes the previous one.",
      render(current),
    ].join("\n")
  return [
    ...(diff.added.length === 0
      ? []
      : ["New MCP server instructions are available in addition to those previously listed:", ...entries(diff.added)]),
    ...(diff.removed.length === 0
      ? []
      : [
          `Instructions for the following MCP servers are no longer available: ${diff.removed.map((server) => server.server).join(", ")}.`,
        ]),
  ].join("\n")
}

export interface Interface {
  readonly load: (agent: AgentV2.Selection) => Effect.Effect<SystemContext.SystemContext>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/McpGuidance") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const mcp = yield* MCP.Service

    return Service.of({
      load: Effect.fn("McpGuidance.load")(function* (selection) {
        const agent = selection.info
        if (!agent) return SystemContext.empty
        const [instructions, tools] = yield* Effect.all([mcp.instructions(), mcp.tools()], {
          concurrency: "unbounded",
        })
        // Hide a server only when every tool it contributes is wholly denied for this agent.
        const visible = instructions
          .filter((item) => {
            const owned = tools.filter((tool) => tool.server === item.server)
            return (
              owned.length === 0 ||
              owned.some(
                (tool) =>
                  PermissionV2.evaluate(McpTool.name(tool.server, tool.name), "*", agent.permissions).effect !== "deny",
              )
            )
          })
          .map((item) => ({ server: item.server, instructions: item.instructions }))
        if (visible.length === 0) return SystemContext.empty
        return SystemContext.make({
          key: SystemContext.Key.make("core/mcp-guidance"),
          codec: Schema.toCodecJson(Schema.Array(Summary)),
          load: Effect.succeed(visible),
          baseline: render,
          update,
          removed: () => "MCP server instructions are no longer available.",
        })
      }),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [MCP.node] })
