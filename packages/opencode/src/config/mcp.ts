import z from "zod"

export const Local = z
  .object({
    type: z.literal("local").describe("Type of MCP server connection"),
    command: z.string().array().describe("Command and arguments to run the MCP server"),
    environment: z
      .record(z.string(), z.string())
      .optional()
      .describe("Environment variables to set when running the MCP server"),
    enabled: z.boolean().optional().describe("Enable or disable the MCP server on startup"),
    timeout: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Timeout in ms for MCP server requests. Defaults to 5000 (5 seconds) if not specified."),
  })
  .strict()
  .meta({
    ref: "McpLocalConfig",
  })

export const OAuth = z
  .object({
    clientId: z
      .string()
      .optional()
      .describe("OAuth client ID. If not provided, dynamic client registration (RFC 7591) will be attempted."),
    clientSecret: z.string().optional().describe("OAuth client secret (if required by the authorization server)"),
    scope: z.string().optional().describe("OAuth scopes to request during authorization"),
    redirectUri: z
      .string()
      .optional()
      .describe("OAuth redirect URI (default: http://127.0.0.1:19876/mcp/oauth/callback)."),
  })
  .strict()
  .meta({
    ref: "McpOAuthConfig",
  })
export type OAuth = z.infer<typeof OAuth>

export const Remote = z
  .object({
    type: z.literal("remote").describe("Type of MCP server connection"),
    url: z.string().describe("URL of the remote MCP server"),
    enabled: z.boolean().optional().describe("Enable or disable the MCP server on startup"),
    headers: z.record(z.string(), z.string()).optional().describe("Headers to send with the request"),
    oauth: z
      .union([OAuth, z.literal(false)])
      .optional()
      .describe("OAuth authentication configuration for the MCP server. Set to false to disable OAuth auto-detection."),
    timeout: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Timeout in ms for MCP server requests. Defaults to 5000 (5 seconds) if not specified."),
  })
  .strict()
  .meta({
    ref: "McpRemoteConfig",
  })

export const Info = z.discriminatedUnion("type", [Local, Remote])
export type Info = z.infer<typeof Info>

export * as ConfigMCP from "./mcp"
