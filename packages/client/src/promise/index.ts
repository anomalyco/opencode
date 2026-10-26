import type { OpenCode } from "./client.js"

export * from "./generated/index.js"
export { OpenCode } from "./client.js"
export type {
  AgentApi,
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
export type {
  EventSubscribeOutput as OpenCodeEvent,
  EventExperimentalSubscribeInput,
} from "./generated/types.js"
export type EventDetailMode = "all" | "subscribed"
export type {
  MediaFileAttachment as PromptMediaFileAttachment,
  Attachment as PromptAttachment,
} from "@opencode/schema/prompt"
export type OpenCodeClient = ReturnType<typeof OpenCode.make>
