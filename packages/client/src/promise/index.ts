import type { OpenCode } from "./client.js"
import type { SessionInboxMediaInfo } from "./generated/types.js"

export * from "./generated/index.js"
export { OpenCode } from "./client.js"
export { mediaHashFromUri, withMediaRefs, type MediaRequestOptions } from "./media.js"
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
export type { EventSubscribeOutput as OpenCodeEvent } from "./generated/types.js"
/** @deprecated Use `SessionInboxMediaInfo`. Removed in the next minor. */
export type SessionInboxInfo = SessionInboxMediaInfo
export type OpenCodeClient = ReturnType<typeof OpenCode.make>
