type Client = ReturnType<typeof import("./generated/client.js").make>

export type AgentApi = Client["agent"]
export type CommandApi = Client["command"]
export type EventApi = Client["event"]
export type FileApi = Client["file"]
export type IntegrationApi = Client["integration"]
export type MessageApi = Client["message"]
export type McpApi = Client["mcp"]
export type ModelApi = Client["model"]
export type PluginApi = Client["plugin"]
export type PermissionApi = Client["permission"]
export type PathApi = Client["path"]
export type ProjectApi = Client["project"]
export type ProviderApi = Client["provider"]
export type QuestionApi = Client["question"]
export type ReferenceApi = Client["reference"]
export type SessionApi = Client["session"]
export type SkillApi = Client["skill"]
export type PtyApi = Client["pty"]
export type VcsApi = Client["vcs"]

export interface CatalogApi {
  readonly provider: ProviderApi
  readonly model: ModelApi
}
