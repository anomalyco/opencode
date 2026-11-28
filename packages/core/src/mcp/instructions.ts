export * as McpInstructions from "./instructions.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer, Schema } from "effect"
import type { CodeModeCatalog } from "../codemode/catalog.js"
import type { Tool } from "../tool.js"
import { McpTool } from "../tool/mcp.js"
import { normalizedName } from "../tool/runtime.js"
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

function catalogPaths(
  items: ReadonlyArray<CodeModeCatalog.Tool | CodeModeCatalog.Namespace>,
  prefix = "",
): ReadonlyArray<string> {
  return items.flatMap((item) => {
    const path = prefix ? `${prefix}.${item.name}` : item.name
    return item.type === "tool" ? [path] : catalogPaths(item.tools, path)
  })
}

export interface Interface {
  /** Lists instructions for MCP servers that have at least one tool in the Session's tool snapshot. */
  readonly load: (tools: Pick<Tool.Snapshot, "definitions" | "codeModeCatalog">) => Effect.Effect<Instructions.List>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/McpInstructions") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const mcp = yield* Mcp.Service

    return Service.of({
      load: Effect.fn("McpInstructions.load")(function* (snapshot) {
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
        const direct = new Set(snapshot.definitions.map((tool) => tool.name))
        const codemode = new Set(snapshot.codeModeCatalog ? catalogPaths(snapshot.codeModeCatalog.tools) : [])
        // Instructions are useful only when this Session can reach at least one server tool.
        const visible = instructions
          .flatMap((item) => {
            const namespace = McpTool.namespace(item.server)
            const owned = tools.filter((tool) => tool.server === item.server)
            const inCodeMode = owned.some((tool) => codemode.has(`${namespace}.${normalizedName({ name: tool.name })}`))
            const inDirect = owned.some((tool) => direct.has(McpTool.name(item.server, tool.name)))
            if (!inCodeMode && !inDirect) return []
            return [
              inCodeMode
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
