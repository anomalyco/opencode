import { Layer } from "effect"
import { GenerateHandler } from "./handlers/generate"
import { MessageHandler } from "./handlers/message"
import { ModelHandler } from "./handlers/model"
import { ProviderHandler } from "./handlers/provider"
import { SessionHandler } from "./handlers/session"
import { PermissionHandler } from "./handlers/permission"
import { FileSystemHandler } from "./handlers/fs"
import { FormHandler } from "./handlers/form"
import { CommandHandler } from "./handlers/command"
import { SkillHandler } from "./handlers/skill"
import { EventHandler } from "./handlers/event"
import { AgentHandler } from "./handlers/agent"
import { PluginHandler } from "./handlers/plugin"
import { HealthHandler } from "./handlers/health"
import { ServerHandler } from "./handlers/server"
import { DebugHandler } from "./handlers/debug"
import { PtyHandler } from "./handlers/pty"
import { ShellHandler } from "./handlers/shell"
import { QuestionHandler } from "./handlers/question"
import { ReferenceHandler } from "./handlers/reference"
import { LocationHandler } from "./handlers/location"
import { IntegrationHandler } from "./handlers/integration"
import { McpHandler } from "./handlers/mcp"
import { CredentialHandler } from "./handlers/credential"
import { ProjectHandler } from "./handlers/project"
import { ProjectCopyHandler } from "./handlers/project-copy"
import { VcsHandler } from "./handlers/vcs"

export const handlers = Layer.mergeAll(
  HealthHandler,
  ServerHandler,
  DebugHandler,
  LocationHandler,
  AgentHandler,
  PluginHandler,
  SessionHandler,
  MessageHandler,
  ModelHandler,
  GenerateHandler,
  ProviderHandler,
  IntegrationHandler,
  McpHandler,
  CredentialHandler,
  ProjectHandler,
  FormHandler,
  PermissionHandler,
  FileSystemHandler,
  CommandHandler,
  SkillHandler,
  EventHandler,
  PtyHandler,
  ShellHandler,
  QuestionHandler,
  ReferenceHandler,
  ProjectCopyHandler,
  VcsHandler,
)
