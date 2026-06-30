import { Layer } from "effect"
import { GenerateHandler } from "./handlers/generate"
import { MessageHandler } from "./handlers/message"
import { ModelHandler } from "./handlers/model"
import { ProviderHandler } from "./handlers/provider"
import { SessionHandler } from "./handlers/session"
import { PermissionHandler } from "./handlers/permission"
import { FileSystemHandler } from "./handlers/fs"
import { CommandHandler } from "./handlers/command"
import { SkillHandler } from "./handlers/skill"
import { EventHandler } from "./handlers/event"
import { AgentHandler } from "./handlers/agent"
import { HealthHandler } from "./handlers/health"
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

export const handlers = Layer.mergeAll(
  HealthHandler,
  LocationHandler,
  AgentHandler,
  SessionHandler,
  MessageHandler,
  ModelHandler,
  GenerateHandler,
  ProviderHandler,
  IntegrationHandler,
  McpHandler,
  CredentialHandler,
  ProjectHandler,
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
)
