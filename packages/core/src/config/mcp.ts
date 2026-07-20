export * as ConfigMCP from "./mcp"

import { Schema } from "effect"
import { Mcp } from "@opencode-ai/schema/mcp"

// The MCP server config is a public wire contract (used by the mcp.add route), so it lives in
// @opencode-ai/schema and is re-exported here.
export const Timeout = Mcp.TimeoutConfig
export type Timeout = Mcp.TimeoutConfig
export const Local = Mcp.LocalConfig
export type Local = Mcp.LocalConfig
export const OAuth = Mcp.OAuthConfig
export type OAuth = Mcp.OAuthConfig
export const Remote = Mcp.RemoteConfig
export type Remote = Mcp.RemoteConfig
export const Server = Mcp.ServerConfig

export class Info extends Schema.Class<Info>("ConfigV2.MCP")({
  timeout: Timeout.pipe(Schema.optional),
  servers: Schema.Record(Schema.String, Server).pipe(Schema.optional),
}) {}
