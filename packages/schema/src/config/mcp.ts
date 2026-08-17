export * as ConfigMCP from "./mcp.js"

import { Schema } from "effect"
import { Mcp } from "../mcp.js"
import { optional } from "../schema.js"

export const Timeout = Mcp.TimeoutConfig
export type Timeout = Mcp.TimeoutConfig
export const Local = Mcp.LocalConfig
export type Local = Mcp.LocalConfig
export const OAuth = Mcp.OAuthConfig
export type OAuth = Mcp.OAuthConfig
export const Remote = Mcp.RemoteConfig
export type Remote = Mcp.RemoteConfig
export const Server = Mcp.ServerConfig

export class Info extends Schema.Class<Info>("Config.MCP")({
  timeout: Timeout.pipe(optional),
  servers: Schema.Record(Schema.String, Server).pipe(optional),
}) {}
