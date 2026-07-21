export * from "./generated/index"
export type {
  AgentApi,
  CatalogApi,
  CommandApi,
  EventApi,
  FileApi,
  IntegrationApi,
  MessageApi,
  McpApi,
  ModelApi,
  PermissionApi,
  PathApi,
  PluginApi,
  ProjectApi,
  ProviderApi,
  QuestionApi,
  ReferenceApi,
  SessionApi,
  SkillApi,
  PtyApi,
  VcsApi,
} from "./api.js"
export type { EventSubscribeOutput as OpenCodeEvent } from "./generated/types"
export type OpenCodeClient = ReturnType<typeof import("./generated/client").make>
