import { Client, SdkHttpError, type Tool as MCPToolDef } from "@modelcontextprotocol/client"
import { dynamicTool, jsonSchema, type JSONSchema7, type Tool } from "ai"
import { Effect } from "effect"

const DEFAULT_TIMEOUT = 30_000

export function defs(client: Client, timeout?: number) {
  return listTools(client, timeout ?? DEFAULT_TIMEOUT).pipe(Effect.catch(() => Effect.void))
}

/**
 * An HTTP 404 on an established session means the server discarded the
 * session (restart, expiry); the caller should reconnect and retry once.
 */
export function isStaleSessionError(error: unknown): boolean {
  return error instanceof SdkHttpError && error.status === 404
}

export function convertTool(
  mcpTool: MCPToolDef,
  client: Client,
  timeout?: number,
  reconnect?: () => Promise<Client | undefined>,
): Tool {
  const inputSchema: JSONSchema7 = {
    ...(mcpTool.inputSchema as JSONSchema7),
    type: "object",
    properties: (mcpTool.inputSchema.properties ?? {}) as JSONSchema7["properties"],
    additionalProperties: false,
  }

  return dynamicTool({
    description: mcpTool.description ?? "",
    inputSchema: jsonSchema(inputSchema),
    execute: async (args: unknown, options) => {
      const call = (target: Client) =>
        target.callTool(
          {
            name: mcpTool.name,
            arguments: (args || {}) as Record<string, unknown>,
          },
          {
            resetTimeoutOnProgress: true,
            signal: options.abortSignal,
            timeout,
            // The MCP SDK only sends a progress token when this hook is present, enabling timeout resets.
            onprogress: () => {},
          },
        )
      const result = await call(client).catch(async (error) => {
        if (!reconnect || !isStaleSessionError(error)) throw error
        const fresh = await reconnect()
        if (!fresh) throw error
        return call(fresh)
      })
      if (result.isError)
        throw new Error(
          result.content
            .flatMap((item) => (item.type === "text" ? [item.text] : []))
            .filter((text) => text.trim())
            .join("\n\n") || "MCP tool returned an error",
        )
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
  const result = await client.listPrompts(undefined, { timeout })
  return result.prompts
}

export async function resources(client: Client, timeout?: number) {
  if (!client.getServerCapabilities()?.resources) return []
  const result = await client.listResources(undefined, { timeout })
  return result.resources
}

export async function resourceTemplates(client: Client, timeout?: number) {
  if (!client.getServerCapabilities()?.resources) return []
  const result = await client.listResourceTemplates(undefined, { timeout })
  return result.resourceTemplates
}

function listTools(client: Client, timeout: number) {
  return Effect.tryPromise({
    try: async () => {
      const result = await client.listTools(undefined, { timeout })
      return result.tools
    },
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  })
}

export * as McpCatalog from "./catalog"
