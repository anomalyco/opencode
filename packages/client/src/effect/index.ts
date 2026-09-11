// TODO: Keep additional network capabilities inside Schema and Protocol as the client grows; /effect must never import
// Core or Server. Preserve these datatype exports so internal model reorganizations do not require caller migrations.
import type { Effect } from "effect"
import type { OpenCode } from "./client.js"

export * from "./generated/index"
export { OpenCode } from "./client.js"
export type {
  AgentApi,
  AppApi,
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
  RpcClient,
  WebSearchApi,
  SessionApi,
  SkillApi,
} from "./api.js"
export { Agent } from "@opencode/schema/agent"
export { Command } from "@opencode/schema/command"
export { Config } from "@opencode/schema/config"
export { Credential } from "@opencode/schema/credential"
export { Event } from "@opencode/schema/event"
export { EventLog } from "@opencode/schema/event-log"
export { FileSystem } from "@opencode/schema/filesystem"
export { Form } from "@opencode/schema/form"
export { Integration } from "@opencode/schema/integration"
export { Location } from "@opencode/schema/location"
export { Model } from "@opencode/schema/model"
export { Permission } from "@opencode/schema/permission"
export { PermissionSaved } from "@opencode/schema/permission-saved"
export { Project } from "@opencode/schema/project"
export { Worktree } from "@opencode/schema/worktree"
export { Vcs } from "@opencode/schema/vcs"
export { Provider } from "@opencode/schema/provider"
export { Pty } from "@opencode/schema/pty"
export { Question } from "@opencode/schema/question"
export { Reference } from "@opencode/schema/reference"
export { WebSearch } from "@opencode/schema/websearch"
export { AbsolutePath, RelativePath } from "@opencode/schema/schema"
export { Session } from "@opencode/schema/session"
export { SessionInbox } from "@opencode/schema/session-inbox"
export { SessionMessage } from "@opencode/schema/session-message"
export { Skill } from "@opencode/schema/skill"
export { Prompt } from "@opencode/schema/prompt"
export { PromptInput } from "@opencode/schema/prompt-input"
export type { OpenCodeEvent } from "@opencode/protocol/groups/event"
export type OpenCodeClient = Effect.Success<ReturnType<typeof OpenCode.make>>
