export * as EventManifest from "./event-manifest.js"

import { Schema } from "effect"
import { Agent } from "./agent.js"
import { Catalog } from "./catalog.js"
import { Command } from "./command.js"
import { Config } from "./config.js"
import { Durable } from "./durable-event-manifest.js"
import { Event } from "./event.js"
import { FileSystem } from "./filesystem.js"
import { FileSystemV1 } from "./filesystem-v1.js"
import { Form } from "./form.js"
import { InstallationEvent } from "./installation-event.js"
import { Integration } from "./integration.js"
import { LegacyEvent } from "./legacy-event.js"
import { LspEvent } from "./lsp-event.js"
import { McpEvent } from "./mcp-event.js"
import { ModelsDev } from "./models-dev.js"
import { Permission } from "./permission.js"
import { PermissionV1 } from "./permission-v1.js"
import { Plugin } from "./plugin.js"
import { Project } from "./project.js"
import { ProjectDirectories } from "./project-directories.js"
import { Pty } from "./pty.js"
import { Question } from "./question.js"
import { QuestionV1 } from "./question-v1.js"
import { Reference } from "./reference.js"
import { ServerEvent } from "./server-event.js"
import { Shell } from "./shell.js"
import { Skill } from "./skill.js"
import { SessionCompactionEvent } from "./session-compaction-event.js"
import { SessionEvent } from "./session-event.js"
import { SessionStatusEvent } from "./session-status-event.js"
import { SessionTodo } from "./session-todo.js"
import { SessionV1 } from "./session-v1.js"
import { TuiEvent } from "./tui-event.js"
import { VcsEvent } from "./vcs-event.js"
import { WorkspaceEvent } from "./workspace-event.js"
import { WorktreeEvent } from "./worktree-event.js"

const sessionV1DurableDefinitions = SessionV1.Event.Definitions.filter(
  (definition) => definition.durability === "durable",
)
const sessionV1LiveDefinitions = SessionV1.Event.Definitions.filter(
  (definition) => definition.durability === "ephemeral",
)

const coreDefinitions = Event.inventory(...sessionV1DurableDefinitions, ...SessionEvent.Definitions)

const foundationDefinitions = Event.inventory(
  ...ModelsDev.Event.Definitions,
  ...Integration.Event.Definitions,
  ...Catalog.Event.Definitions,
  ...Agent.Event.Definitions,
  ...coreDefinitions,
)

const featureDefinitions = Event.inventory(
  ...FileSystem.Event.Definitions,
  ...Reference.Event.Definitions,
  ...Permission.Event.Definitions,
  ...Plugin.Event.Definitions,
  ...ProjectDirectories.Event.Definitions,
  ...Command.Event.Definitions,
  ...Config.Event.Definitions,
  ...Skill.Event.Definitions,
  ...Pty.Event.Definitions,
  ...Shell.Event.Definitions,
  ...Question.Event.Definitions,
  ...Form.Event.Definitions,
)

export const ServerDefinitions = Event.inventory(
  ...foundationDefinitions,
  ...featureDefinitions,
  ...SessionTodo.Event.Definitions,
  // Current events the TUI consumes from the public stream.
  ...SessionStatusEvent.Definitions,
  ...TuiEvent.Definitions,
  ...InstallationEvent.Definitions,
  ...VcsEvent.Definitions,
  McpEvent.StatusChanged,
  McpEvent.ResourcesChanged,
  // Shared transitional: V1 contracts the current TUI still consumes during
  // the migration (permission.asked/replied, question.asked, session.error).
  // Remove when the TUI moves to the current permission/question surfaces.
  ...PermissionV1.Event.Definitions,
  ...QuestionV1.Event.Definitions,
  SessionV1.Error,
)
export const Server = Event.latest(ServerDefinitions)
export type ServerEvent = Schema.Schema.Type<(typeof ServerDefinitions)[number]>
export const isServer = (event: { readonly type: string }): event is ServerEvent => Server.has(event.type)

export const Definitions = Event.inventory(
  ...foundationDefinitions,
  ...sessionV1LiveDefinitions,
  ...InstallationEvent.Definitions,
  ...featureDefinitions,
  ...SessionTodo.Event.Definitions,
  ...LspEvent.Definitions,
  ...PermissionV1.Event.Definitions,
  ...TuiEvent.Definitions,
  ...McpEvent.Definitions,
  ...LegacyEvent.Definitions,
  ...FileSystemV1.Event.Definitions,
  ...Project.Event.Definitions,
  ...SessionStatusEvent.Definitions,
  ...QuestionV1.Event.Definitions,
  ...SessionCompactionEvent.Definitions,
  ...VcsEvent.Definitions,
  ...WorkspaceEvent.Definitions,
  ...WorktreeEvent.Definitions,
  ...ServerEvent.Definitions,
)
export const Latest = Event.latest(Definitions)
export { Durable }
