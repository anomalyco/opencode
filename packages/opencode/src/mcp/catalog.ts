import { Client, type CallToolResult, type Tool as MCPToolDef } from "@modelcontextprotocol/client"
import { CallToolResultSchema, ListToolsResultSchema, ToolSchema } from "@modelcontextprotocol/sdk/types.js"
import { dynamicTool, jsonSchema, type JSONSchema7, type Tool } from "ai"
import { Effect } from "effect"

const DEFAULT_TIMEOUT = 30_000
const MAX_LIST_PAGES = 1_000

export interface McpTool {
  readonly def: MCPToolDef
  readonly client: Client
  readonly timeout?: number
}

function sanitizeMCPSchemaForOpenAI(schema: JSONSchema7): JSONSchema7 {
  const result: JSONSchema7 = { ...schema }
  if (result.properties) {
    const cleanedProperties: Record<string, any> = {}
    for (const [key, prop] of Object.entries(result.properties)) {
      if (typeof prop !== "object" || prop === null) {
        cleanedProperties[key] = prop
        continue
      }
      let cleaned: any = { ...prop }
      if (Array.isArray(cleaned.anyOf)) {
        const nonNullTypes = cleaned.anyOf.filter(
          (anyOf: any) => anyOf.type !== "null"
        )
        if (nonNullTypes.length === 1) {
          cleaned = { ...cleaned, ...nonNullTypes[0] }
          delete cleaned.anyOf
        }
      }
      delete cleaned.default
      cleanedProperties[key] = cleaned
    }
    result.properties = cleanedProperties
  }
  return result
}

const TolerantListToolsResultSchema = ListToolsResultSchema.extend({
  tools: ToolSchema.omit({ outputSchema: true }).array(),
})

export async function paginate<T, R extends { nextCursor?: string }>(
  list: (cursor?: string) => Promise<R>,
  items: (result: R) => T[],
) {
  const result: T[] = []
  const cursors = new Set<string>()
  let cursor: string | undefined

  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const page = await list(cursor)
    result.push(...items(page))
    if (page.nextCursor === undefined) return result
    if (cursors.has(page.nextCursor)) throw new Error(`MCP list returned duplicate cursor: ${page.nextCursor}`)
    cursors.add(page.nextCursor)
    cursor = page.nextCursor
  }

  throw new Error(`MCP list exceeded ${MAX_LIST_PAGES} pages`)
}

export async function callTool(
  tool: McpTool,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<CallToolResult> {
  const cleanArgs = Object.fromEntries(
    Object.entries(args || {}).filter(
      ([, v]) => v !== null && v !== undefined,
    ),
  )
  const result = await tool.client.callTool(
    { name: tool.def.name, arguments: cleanArgs },
    CallToolResultSchema,
    {
      resetTimeoutOnProgress: true,
      signal,
      timeout: tool.timeout,
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
  const rawSchema = tool.def.inputSchema as JSONSchema7
  const inputSchema: JSONSchema7 = {
    ...rawSchema,
    type: "object",
    properties: (rawSchema.properties ?? {}) as JSONSchema7["properties"],
    additionalProperties: false,
  }
  const sanitizedSchema = sanitizeMCPSchemaForOpenAI(inputSchema)

  return dynamicTool({
    description: tool.def.description ?? "",
    inputSchema: jsonSchema(sanitizedSchema),
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

export function prompts(client: Client, timeout?: number) {
  if (!client.getServerCapabilities()?.prompts) return Promise.resolve([])
  return paginate(
    (cursor) => client.listPrompts(cursor === undefined ? undefined : { cursor }, { timeout }),
    (result) => result.prompts,
  )
}

export function resources(client: Client, timeout?: number) {
  if (!client.getServerCapabilities()?.resources) return Promise.resolve([])
  return paginate(
    (cursor) => client.listResources(cursor === undefined ? undefined : { cursor }, { timeout }),
    (result) => result.resources,
  )
}

export function resourceTemplates(client: Client, timeout?: number) {
  if (!client.getServerCapabilities()?.resources) return Promise.resolve([])
  return paginate(
    (cursor) => client.listResourceTemplates(cursor === undefined ? undefined : { cursor }, { timeout }),
    (result) => result.resourceTemplates,
  )
}

function listTools(client: Client, timeout: number) {
  return Effect.tryPromise({
    try: () =>
      paginate(
        async (cursor) => {
          const params = cursor === undefined ? undefined : { cursor }
          try {
            return await client.listTools(params, { timeout })
          } catch (error) {
            if (!(error instanceof Error) || !isOutputSchemaValidationError(error)) throw error
            return client.request({ method: "tools/list", params }, TolerantListToolsResultSchema, { timeout })
          }
        },
        (result) => result.tools,
      ),
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  })
}

function isOutputSchemaValidationError(error: Error) {
  return /can't resolve reference|resolves to more than one schema|outputSchema|schema.*reference|reference.*schema/i.test(
    error.message,
  )
}

export * as McpCatalog from "./catalog"
