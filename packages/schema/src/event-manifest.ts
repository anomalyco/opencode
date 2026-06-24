export * as EventManifest from "./event-manifest"

import { Catalog } from "./catalog"
import { Event } from "./event"
import { FileSystem } from "./filesystem"
import { FileSystemWatcher } from "./filesystem-watcher"
import { InstallationEvent } from "./installation-event"
import { Integration } from "./integration"
import { LegacyEvent } from "./legacy-event"
import { LspEvent } from "./lsp-event"
import { McpEvent } from "./mcp-event"
import { ModelsDev } from "./models-dev"
import { Permission } from "./permission"
import { PermissionV1 } from "./permission-v1"
import { Plugin } from "./plugin"
import { ProjectDirectories } from "./project-directories"
import { Pty } from "./pty"
import { Question } from "./question"
import { QuestionV1 } from "./question-v1"
import { Reference } from "./reference"
import { ServerEvent } from "./server-event"
import { SessionCompactionEvent } from "./session-compaction-event"
import { SessionEvent } from "./session-event"
import { SessionStatusEvent } from "./session-status-event"
import { SessionTodo } from "./session-todo"
import { SessionV1 } from "./session-v1"
import { TuiEvent } from "./tui-event"
import { VcsEvent } from "./vcs-event"
import { WorkspaceEvent } from "./workspace-event"
import { WorktreeEvent } from "./worktree-event"

export const CoreDefinitions = Event.inventory(...SessionV1.Events, ...SessionEvent.Definitions)
export const CoreLatest = Event.latest(CoreDefinitions)
export const CoreDurable = Event.durable(CoreDefinitions)

export const FoundationDefinitions = Event.inventory(
  ModelsDev.Event.Refreshed,
  Integration.Event.Updated,
  Integration.Event.ConnectionUpdated,
  Catalog.Event.Updated,
  ...CoreDefinitions,
)

export const FeatureDefinitions = Event.inventory(
  FileSystem.Event.Edited,
  Reference.Event.Updated,
  Permission.Event.Asked,
  Permission.Event.Replied,
  Plugin.Event.Added,
  ProjectDirectories.Event.Updated,
  FileSystemWatcher.Event.Updated,
  Pty.Event.Created,
  Pty.Event.Updated,
  Pty.Event.Exited,
  Pty.Event.Deleted,
  Question.Event.Asked,
  Question.Event.Replied,
  Question.Event.Rejected,
)

export const PublicDefinitions = Event.inventory(
  ...FoundationDefinitions,
  ...FeatureDefinitions,
  SessionTodo.Event.Updated,
)
export const PublicLatest = Event.latest(PublicDefinitions)
export const PublicDurable = Event.durable(PublicDefinitions)

export const Definitions = Event.inventory(
  ...FoundationDefinitions,
  SessionV1.PartDelta,
  SessionV1.Diff,
  SessionV1.Error,
  InstallationEvent.Updated,
  InstallationEvent.UpdateAvailable,
  ...FeatureDefinitions,
  SessionTodo.Event.Updated,
  LspEvent.Updated,
  PermissionV1.Event.Asked,
  PermissionV1.Event.Replied,
  TuiEvent.PromptAppend,
  TuiEvent.CommandExecute,
  TuiEvent.ToastShow,
  TuiEvent.SessionSelect,
  McpEvent.ToolsChanged,
  McpEvent.BrowserOpenFailed,
  LegacyEvent.CommandExecuted,
  LegacyEvent.ProjectUpdated,
  SessionStatusEvent.Status,
  SessionStatusEvent.Idle,
  QuestionV1.Event.Asked,
  QuestionV1.Event.Replied,
  QuestionV1.Event.Rejected,
  SessionCompactionEvent.Compacted,
  VcsEvent.BranchUpdated,
  WorkspaceEvent.Ready,
  WorkspaceEvent.Failed,
  WorkspaceEvent.Status,
  WorktreeEvent.Ready,
  WorktreeEvent.Failed,
  ServerEvent.Connected,
  ServerEvent.Disposed,
)
export const Latest = Event.latest(Definitions)
export const Durable = Event.durable(Definitions)
