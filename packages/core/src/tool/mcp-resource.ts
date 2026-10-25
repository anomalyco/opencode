import { Effect, Schema } from "effect"
import { MCP } from "../mcp"
import * as Tool from "./tool"
import LIST_DESCRIPTION from "./mcp-resources.txt"
import READ_DESCRIPTION from "./mcp-resource-read.txt"

const MAX_OUTPUT = 50_000

export const ListParameters = Schema.Struct({
  server: Schema.optional(Schema.String).annotate({
    description: "Optional MCP server name. When omitted, lists resources from every connected server.",
  }),
})

export const ReadParameters = Schema.Struct({
  server: Schema.String.annotate({ description: "The MCP server name exactly as returned by mcp_resources" }),
  uri: Schema.String.annotate({ description: "The resource URI exactly as returned by mcp_resources" }),
})

export interface Row {
  client: string
  uri: string
  name: string
  description?: string
  mimeType?: string
}

/** Render a resource listing sorted by server then URI, one resource per line. */
export function shape(rows: Row[]): string {
  if (rows.length === 0) return "No resources are available from connected MCP servers."
  const sorted = rows.toSorted((a, b) => a.client.localeCompare(b.client) || a.uri.localeCompare(b.uri))
  return sorted
    .map((row) =>
      [
        `server: ${row.client}`,
        `uri: ${row.uri}`,
        `name: ${row.name}`,
        row.mimeType ? `mimeType: ${row.mimeType}` : undefined,
        row.description ? `description: ${row.description}` : undefined,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n"),
    )
    .join("\n\n")
}

export interface Content {
  uri: string
  mimeType?: string
  text?: unknown
  blob?: unknown
}

/**
 * Extract readable text from MCP resource contents, capping the output.
 * Blob-only and otherwise text-free results become clear errors instead of
 * garbled or empty output.
 */
export function extract(
  contents: Content[],
  cap: number,
): { ok: true; output: string; truncated: boolean } | { ok: false; reason: string } {
  const texts = contents.filter((item) => typeof item.text === "string")
  if (texts.length === 0) {
    const binary = contents.filter((item) => item.blob !== undefined)
    if (binary.length > 0) {
      const mimes = [...new Set(binary.map((item) => item.mimeType ?? "unknown"))].join(", ")
      return {
        ok: false,
        reason: `resource has binary (blob) content with MIME type ${mimes}; only text resources are supported`,
      }
    }
    return { ok: false, reason: "resource returned no text content" }
  }
  const joined = texts.map((item) => item.text as string).join("\n\n")
  if (joined.length <= cap) return { ok: true, output: joined, truncated: false }
  return { ok: true, output: joined.slice(0, cap), truncated: true }
}

export const McpResourcesTool = Tool.define(
  "mcp_resources",
  Effect.gen(function* () {
    const mcp = yield* MCP.Service

    return {
      description: LIST_DESCRIPTION,
      parameters: ListParameters,
      execute: (params: Schema.Schema.Type<typeof ListParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "mcp_resources",
            patterns: [params.server ?? "*"],
            always: ["*"],
            metadata: {},
          })

          if (params.server) {
            const clients = yield* mcp.clients()
            if (!clients[params.server]) {
              const names = Object.keys(clients).sort()
              throw new Error(`Unknown MCP server "${params.server}". Connected servers: ${names.join(", ") || "none"}`)
            }
          }

          const rows = Object.values(yield* mcp.resources(params.server)).map((item) => ({
            client: item.client,
            uri: item.uri,
            name: item.name,
            description: item.description,
            mimeType: item.mimeType,
          }))

          return {
            title: `${rows.length} MCP resources`,
            output: shape(rows),
            metadata: { count: rows.length },
          }
        }),
    }
  }),
)

export const McpResourceReadTool = Tool.define(
  "mcp_resource_read",
  Effect.gen(function* () {
    const mcp = yield* MCP.Service

    return {
      description: READ_DESCRIPTION,
      parameters: ReadParameters,
      execute: (params: Schema.Schema.Type<typeof ReadParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "mcp_resource_read",
            patterns: [`${params.server} ${params.uri}`],
            always: ["*"],
            metadata: {},
          })

          const clients = yield* mcp.clients()
          if (!clients[params.server]) {
            const names = Object.keys(clients).sort()
            throw new Error(`Unknown MCP server "${params.server}". Connected servers: ${names.join(", ") || "none"}`)
          }

          const result = yield* mcp.readResource(params.server, params.uri)
          if (!result) {
            throw new Error(
              `Failed to read resource "${params.uri}" from MCP server "${params.server}". Check the URI against the mcp_resources listing.`,
            )
          }

          const extracted = extract(
            result.contents.map((item) => ({
              uri: item.uri,
              mimeType: item.mimeType,
              text: "text" in item ? item.text : undefined,
              blob: "blob" in item ? item.blob : undefined,
            })),
            MAX_OUTPUT,
          )
          if (!extracted.ok) {
            throw new Error(`Cannot read resource "${params.uri}" from "${params.server}": ${extracted.reason}`)
          }

          return {
            title: `${params.server} ${params.uri}`,
            output: extracted.truncated
              ? extracted.output + `\n\n(truncated: showing first ${MAX_OUTPUT} characters)`
              : extracted.output,
            metadata: {
              server: params.server,
              uri: params.uri,
              truncated: extracted.truncated,
            },
          }
        }),
    }
  }),
)
