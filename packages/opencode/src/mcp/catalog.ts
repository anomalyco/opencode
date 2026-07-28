import { Client, type CallToolResult, type Tool as MCPToolDef } from "@modelcontextprotocol/client"
import { dynamicTool, jsonSchema, type JSONSchema7, type Tool } from "ai"
import { Effect } from "effect"

const DEFAULT_TIMEOUT = 30_000

export interface McpTool {
  readonly def: MCPToolDef
  readonly client: Client
  readonly timeout?: number
}

export async function callTool(
  tool: McpTool,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<CallToolResult> {
  const result = await tool.client.callTool(
    { name: tool.def.name, arguments: args },
    {
      resetTimeoutOnProgress: true,
      signal,
      timeout: tool.timeout,
      // The MCP SDK only sends a progress token when this hook is present, enabling timeout resets.
      onprogress: () => {},
    },
  )
  if (result.isError)
    throw new Error(
      result.content
        .flatMap((item) => (item.type === "text" ? [item.text] : []))
        .filter((text) => text.trim())
        .join("\n\n") || "MCP tool returned an error",
    )
  return result
}

export function defs(client: Client, timeout?: number) {
  return listTools(client, timeout ?? DEFAULT_TIMEOUT).pipe(Effect.catch(() => Effect.void))
}

export function convertTool(tool: McpTool): Tool {
  const inputSchema: JSONSchema7 = {
    ...(tool.def.inputSchema as JSONSchema7),
    type: "object",
    properties: (tool.def.inputSchema.properties ?? {}) as JSONSchema7["properties"],
    additionalProperties: false,
  }

  return dynamicTool({
    description: tool.def.description ?? "",
    inputSchema: jsonSchema(inputSchema),
    execute: async (args: unknown, options) => {
      const result = await callTool(tool, (args || {}) as Record<string, unknown>, options.abortSignal)
      if (result.content.length > 0 || result.structuredContent === undefined || result.structuredContent === null)
        return result
      return {
        ...result,
        content: [{ type: "text" as const, text: JSON.stringify(result.structuredContent) }],
      }
    },
  })
}

export function fetch<T extends { name: string }>(
  clientName: string,
  client: Client,
  list: (client: Client) => Promise<T[]>,
  label: string,
  key?: (item: T) => string,
) {
  return Effect.tryPromise({
    try: () => list(client),
    catch: (error) => error,
  }).pipe(
    Effect.tapError((error) =>
      Effect.logWarning(`failed to get ${label}`, {
        clientName,
        error: error instanceof Error ? error.message : String(error),
      }),
    ),
    Effect.map((items) => {
      const sanitizedClient = sanitize(clientName)
      // Escape both the separator and escape marker so `server:uri` keys remain unambiguous.
      const resourceClient = clientName.replaceAll("%", "%25").replaceAll(":", "%3A")
      return Object.fromEntries(
        items.map((item) => [
          key ? resourceClient + ":" + key(item) : sanitizedClient + ":" + sanitize(item.name),
          { ...item, client: clientName },
        ]),
      )
    }),
    Effect.orElseSucceed(() => undefined),
  )
}

export const sanitize = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_")

export const toolName = (clientName: string, name: string) => sanitize(clientName) + "_" + sanitize(name)

export async function prompts(client: Client, timeout?: number) {
  if (!client.getServerCapabilities()?.prompts) return []
  return (await client.listPrompts(undefined, { timeout })).prompts
}

export async function resources(client: Client, timeout?: number) {
  if (!client.getServerCapabilities()?.resources) return []
  return (await client.listResources(undefined, { timeout })).resources
}

export async function resourceTemplates(client: Client, timeout?: number) {
  if (!client.getServerCapabilities()?.resources) return []
  return (await client.listResourceTemplates(undefined, { timeout })).resourceTemplates
}

function listTools(client: Client, timeout: number) {
  return Effect.tryPromise({
    try: async () => (await client.listTools(undefined, { timeout })).tools,
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  })
}

export * as McpCatalog from "./catalog"
