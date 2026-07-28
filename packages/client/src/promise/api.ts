type Client = ReturnType<typeof import("./generated/client.js").make>

export type AgentApi = Client["agent"]
export type CommandApi = Client["command"]
export type EventApi = Client["event"]
export type IntegrationApi = Client["integration"]
export type ModelApi = Client["model"]
export type PluginApi = Client["plugin"]
export type ProviderApi = Client["provider"]
export type ReferenceApi = Client["reference"]
export type WebSearchApi = Client["websearch"]
export type SessionApi = Client["session"]
export type SkillApi = Client["skill"]

export interface CatalogApi {
  readonly provider: ProviderApi
  readonly model: ModelApi
}
