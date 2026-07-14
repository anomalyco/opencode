// TODO: Keep additional network capabilities inside Schema and Protocol as the client grows; /effect must never import
// Core or Server. Preserve these datatype exports so internal model reorganizations do not require caller migrations.
import type { Effect } from "effect"

export * from "./generated/index"
export type {
  AgentApi,
  AppApi,
  CatalogApi,
  CommandApi,
  EventApi,
  IntegrationApi,
  ModelApi,
  PluginApi,
  ProviderApi,
  ReferenceApi,
  SessionApi,
  SkillApi,
} from "./api.js"
export { Service } from "./service.js"
export { Agent } from "@opencode-ai/schema/agent"
export { Command } from "@opencode-ai/schema/command"
export { Credential } from "@opencode-ai/schema/credential"
export { Event } from "@opencode-ai/schema/event"
export { EventLog } from "@opencode-ai/schema/event-log"
export { FileSystem } from "@opencode-ai/schema/filesystem"
export { Form } from "@opencode-ai/schema/form"
export { Integration } from "@opencode-ai/schema/integration"
export { Location } from "@opencode-ai/schema/location"
export { Model } from "@opencode-ai/schema/model"
export { Permission } from "@opencode-ai/schema/permission"
export { PermissionSaved } from "@opencode-ai/schema/permission-saved"
export { Project } from "@opencode-ai/schema/project"
export { ProjectCopy } from "@opencode-ai/schema/project-copy"
export { Provider } from "@opencode-ai/schema/provider"
export { Pty } from "@opencode-ai/schema/pty"
export { Question } from "@opencode-ai/schema/question"
export { Reference } from "@opencode-ai/schema/reference"
export { AbsolutePath, RelativePath } from "@opencode-ai/schema/schema"
export { Session } from "@opencode-ai/schema/session"
export { SessionPending } from "@opencode-ai/schema/session-pending"
export { SessionMessage } from "@opencode-ai/schema/session-message"
export { Skill } from "@opencode-ai/schema/skill"
export { Prompt } from "@opencode-ai/schema/prompt"
export { PromptInput } from "@opencode-ai/schema/prompt-input"
export type { OpenCodeEvent } from "@opencode-ai/protocol/groups/event"
export type OpenCodeClient = Effect.Success<ReturnType<typeof import("./generated/client").make>>
