export * as McpInstructions from "./instructions.js"

import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { Context, Effect, Layer, Schema } from "effect"
import { Agent } from "../agent.js"
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

const update = (previous: ReadonlyArray<Summary>, current: ReadonlyArray<Summary>) => {
  const diff = Instructions.diffByKey(
    previous,
    current,
    (server) => server.server,
    (before, after) => before.instructions !== after.instructions || before.codemode !== after.codemode,
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
  readonly load: (agent: Agent.Selection) => Effect.Effect<Instructions.List>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/McpInstructions") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const mcp = yield* Mcp.Service

    return Service.of({
      load: Effect.fn("McpInstructions.load")(function* (selection) {
        const agent = selection.info
        if (!agent) return Instructions.empty
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
        const canExecute = Permission.evaluate("execute", "*", agent.permissions).effect !== "deny"
        // Instructions are useful only when this agent can reach at least one server tool.
        const visible = instructions
          .flatMap((item) => {
            const owned = tools.filter((tool) => tool.server === item.server)
            const codemode = owned[0]?.codemode !== false
            if (codemode && !canExecute) return []
            if (
              !owned.some(
                (tool) =>
                  Permission.evaluate(McpTool.name(tool.server, tool.name), "*", agent.permissions).effect !== "deny",
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
