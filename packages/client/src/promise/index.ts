import type { OpenCode } from "./client.js"

export * from "./generated/index.js"
export { OpenCode } from "./client.js"
export type {
  AgentApi,
  CatalogApi,
  CommandApi,
  ConfigApi,
  EventApi,
  IntegrationApi,
  ModelApi,
  PluginApi,
  ProviderApi,
  ReferenceApi,
  RpcApi,
  RpcCallOptions,
  RpcClient,
  RpcEventPayload,
  WebSearchApi,
  SessionApi,
  SkillApi,
} from "./api.js"
export type { EventSubscribeOutput as OpenCodeEvent } from "./generated/types.js"
export type OpenCodeClient = ReturnType<typeof OpenCode.make>
