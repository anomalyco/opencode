export * from "./generated/index"
export type {
  AgentApi,
  CatalogApi,
  CommandApi,
  EventApi,
  IntegrationApi,
  ModelApi,
  PluginApi,
  ProviderApi,
  ReferenceApi,
  WebSearchApi,
  SessionApi,
  SkillApi,
} from "./api.js"
export type { EventSubscribeOutput as OpenCodeEvent } from "./generated/types"
export type OpenCodeClient = ReturnType<typeof import("./generated/client").make>
