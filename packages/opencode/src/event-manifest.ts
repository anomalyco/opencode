export * as EventManifest from "./event-manifest"

import { Event } from "@opencode-ai/schema/event"
import { PublicEventManifest } from "@opencode-ai/core/public-event-manifest"
import { Command } from "@/command"
import { Workspace } from "@/control-plane/workspace"
import { Ide } from "@/ide"
import { Installation } from "@/installation"
import { LSP } from "@/lsp/lsp"
import { MCP } from "@/mcp"
import { Permission } from "@/permission"
import { Project } from "@/project/project"
import { Vcs } from "@/project/vcs"
import { Question } from "@/question"
import { ServerEvent } from "@/server/event"
import { TuiEvent } from "@/server/tui-event"
import { MessageV2 } from "@/session/message-v2"
import { Session } from "@/session/session"
import { SessionCompaction } from "@/session/compaction"
import { SessionStatus } from "@/session/status"
import { Worktree } from "@/worktree"

export const Definitions = Event.inventory(
  ...PublicEventManifest.FoundationDefinitions,
  MessageV2.Event.PartDelta,
  Session.Event.Diff,
  Session.Event.Error,
  Installation.Event.Updated,
  Installation.Event.UpdateAvailable,
  ...PublicEventManifest.FeatureDefinitions,
  LSP.Event.Updated,
  Permission.Event.Asked,
  Permission.Event.Replied,
  TuiEvent.PromptAppend,
  TuiEvent.CommandExecute,
  TuiEvent.ToastShow,
  TuiEvent.SessionSelect,
  MCP.ToolsChanged,
  MCP.BrowserOpenFailed,
  Command.Event.Executed,
  Project.Event.Updated,
  SessionStatus.Event.Status,
  SessionStatus.Event.Idle,
  Question.Event.Asked,
  Question.Event.Replied,
  Question.Event.Rejected,
  SessionCompaction.Event.Compacted,
  Vcs.Event.BranchUpdated,
  Workspace.Event.Ready,
  Workspace.Event.Failed,
  Workspace.Event.Status,
  Worktree.Event.Ready,
  Worktree.Event.Failed,
  Ide.Event.Installed,
  ServerEvent.Event.Connected,
  ServerEvent.Event.Disposed,
)

export const Latest = Event.latest(Definitions)
export const Durable = Event.durable(Definitions)
