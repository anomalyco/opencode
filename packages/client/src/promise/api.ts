import type { OpenCode } from "./client.js"

type Client = ReturnType<typeof OpenCode.make>

export type { RpcApi, RpcCallOptions, RpcClient, RpcEventPayload } from "./rpc.js"
export type { PermissionCreateInput } from "./generated/types.js"

export type AgentApi = Client["agent"]
export type CommandApi = Client["command"]
export type ConfigApi = Client["config"]
export type EventApi = Client["event"]
export type GenerateApi = Client["generate"]
export type IntegrationApi = Client["integration"]
export type McpApi = Client["mcp"]
export type ModelApi = Client["model"]
export type PluginApi = Client["plugin"]
export type PermissionApi = Client["permission"]
export type ProviderApi = Client["provider"]
export type ReferenceApi = Client["reference"]
export type WebSearchApi = Client["websearch"]
export type SessionApi = Client["session"]
export type SkillApi = Client["skill"]
export type VcsApi = Client["vcs"]

export interface CatalogApi {
  readonly provider: ProviderApi
  readonly model: ModelApi
}
