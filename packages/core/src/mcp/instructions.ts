export * as McpInstructions from "./instructions.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer, Schema } from "effect"
import { Permission } from "../permission.js"
import { McpTool } from "../tool/mcp.js"
import { Mcp } from "./index.js"
import { Instructions } from "../instructions/index.js"

const Summary = Schema.Struct({
  server: Schema.String,
  instructions: Schema.String,
  codemode: Schema.optionalKey(Schema.Literal(false)),
})
type Summary = typeof Summary.Type

const entries = (servers: ReadonlyArray<Summary>) =>
  servers.flatMap((server) => {
    const result = [`  <server name="${server.server}">`]
    if (server.codemode !== false)
      result.push(
        `    Use tools from this server through \`execute\` under \`tools[${JSON.stringify(McpTool.namespace(server.server))}]\`.`,
      )
    result.push(...server.instructions.split("\n").map((line) => `    ${line}`), "  </server>")
    return result
  })

const render = (servers: ReadonlyArray<Summary>) =>
  ["<mcp_instructions>", ...entries(servers), "</mcp_instructions>"].join("\n")

const update = Instructions.listUpdate<Summary>({
  key: (server) => server.server,
  changed: (before, after) => before.instructions !== after.instructions || before.codemode !== after.codemode,
  entries,
  render,
  text: {
    replaced: "The available MCP server instructions have changed. This list supersedes the previous one.",
    added: "New MCP server instructions are available in addition to those previously listed:",
    changed:
      "The following MCP server instructions have changed. Each entry replaces the previously listed server with the same name:",
    removed: (names) => `Instructions for the following MCP servers are no longer available: ${names}.`,
  },
})

export interface Interface {
  /** Lists server instructions reachable under the given ruleset; callers pass the merged agent and Session permissions. */
  readonly load: (permissions: Permission.Ruleset) => Effect.Effect<Instructions.List>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/McpInstructions") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const mcp = yield* Mcp.Service

    return Service.of({
      load: Effect.fn("McpInstructions.load")(function* (permissions) {
        const source = (value: ReadonlyArray<Summary> | Instructions.Removed) =>
          Instructions.make<ReadonlyArray<Summary>>({
            key: Instructions.Key.make("core/mcp-guidance"),
            codec: Schema.toCodecJson(Schema.Array(Summary)),
            read: Effect.succeed(value),
            render: {
              initial: render,
              changed: update,
              removed: () => "MCP server instructions are no longer available.",
            },
          })
        const [instructions, tools] = yield* Effect.all([mcp.instructions(), mcp.tools()], {
          concurrency: "unbounded",
        })
        const canExecute = Permission.evaluate("execute", "*", permissions).effect !== "deny"
        // Instructions are useful only when this Session can reach at least one server tool.
        const visible = instructions
          .flatMap((item) => {
            const owned = tools.filter((tool) => tool.server === item.server)
            // Without execute, Code Mode server tools are exposed directly.
            const codemode = canExecute && owned[0]?.codemode !== false
            if (
              !owned.some(
                (tool) =>
                  Permission.evaluate(McpTool.name(tool.server, tool.name), "*", permissions).effect !== "deny",
              )
            )
              return []
            return [
              codemode
                ? { server: item.server, instructions: item.instructions }
                : { server: item.server, instructions: item.instructions, codemode: false as const },
            ]
          })
          .toSorted((a, b) => a.server.localeCompare(b.server))
        return source(visible.length === 0 ? Instructions.removed : visible)
      }),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Mcp.node] })
