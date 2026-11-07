// TODO: Keep additional network capabilities inside Schema and Protocol as the client grows; /effect must never import
// Core or Server. Preserve these datatype exports so internal model reorganizations do not require caller migrations.
import type { Effect } from "effect"
import type { OpenCode } from "./client.js"

export * from "./generated/index"
export { OpenCode } from "./client.js"
export type {
  AgentApi,
  AppApi,
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
export { Agent } from "@Mackery6969/schema/agent"
export { Command } from "@Mackery6969/schema/command"
export { Config } from "@Mackery6969/schema/config"
export { Credential } from "@Mackery6969/schema/credential"
export { Event } from "@Mackery6969/schema/event"
export { EventLog } from "@Mackery6969/schema/event-log"
export { FileSystem } from "@Mackery6969/schema/filesystem"
export { Form } from "@Mackery6969/schema/form"
export { Integration } from "@Mackery6969/schema/integration"
export { Location } from "@Mackery6969/schema/location"
export { Model } from "@Mackery6969/schema/model"
export { Permission } from "@Mackery6969/schema/permission"
export { PermissionSaved } from "@Mackery6969/schema/permission-saved"
export { Project } from "@Mackery6969/schema/project"
export { Worktree } from "@Mackery6969/schema/worktree"
export { Vcs } from "@Mackery6969/schema/vcs"
export { Provider } from "@Mackery6969/schema/provider"
export { Pty } from "@Mackery6969/schema/pty"
export { Question } from "@Mackery6969/schema/question"
export { Reference } from "@Mackery6969/schema/reference"
export { WebSearch } from "@Mackery6969/schema/websearch"
export { AbsolutePath, RelativePath } from "@Mackery6969/schema/schema"
export { Session } from "@Mackery6969/schema/session"
export { SessionInbox } from "@Mackery6969/schema/session-inbox"
export { SessionMessage } from "@Mackery6969/schema/session-message"
export { Skill } from "@Mackery6969/schema/skill"
export { Prompt } from "@Mackery6969/schema/prompt"
export { PromptInput } from "@Mackery6969/schema/prompt-input"
export type { OpenCodeEvent } from "@Mackery6969/protocol/groups/event"
export type OpenCodeClient = Effect.Success<ReturnType<typeof OpenCode.make>>
