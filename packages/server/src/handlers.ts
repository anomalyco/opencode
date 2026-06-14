import { SessionV2 } from "@daemon-protocol/core/session"
import { LocationServiceMap } from "@daemon-protocol/core/location-layer"
import { PermissionSaved } from "@daemon-protocol/core/permission/saved"
import { PtyTicket } from "@daemon-protocol/core/pty/ticket"
import { Layer } from "effect"
import { layer as locationLayer } from "./groups/location"
import { sessionLocationLayer } from "./middleware/session-location"
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
import { QuestionHandler } from "./handlers/question"
import { ReferenceHandler } from "./handlers/reference"
import * as SessionExecutionLocal from "@daemon-protocol/core/session/execution/local"
import { LocationHandler } from "./handlers/location"
import { IntegrationHandler } from "./handlers/integration"
import { CredentialHandler } from "./handlers/credential"
import { Credential } from "@daemon-protocol/core/credential"
import { ProjectCopyHandler } from "./handlers/project-copy"

export const handlers = Layer.mergeAll(
  HealthHandler,
  LocationHandler,
  AgentHandler,
  SessionHandler,
  MessageHandler,
  ModelHandler,
  ProviderHandler,
  IntegrationHandler,
  CredentialHandler,
  PermissionHandler,
  FileSystemHandler,
  CommandHandler,
  SkillHandler,
  EventHandler,
  PtyHandler,
  QuestionHandler,
  ReferenceHandler,
  ProjectCopyHandler,
).pipe(
  Layer.provide(sessionLocationLayer),
  Layer.provide(locationLayer),
  Layer.provide(SessionV2.defaultLayer),
  Layer.provide(SessionExecutionLocal.defaultLayer),
  Layer.provide(PermissionSaved.defaultLayer),
  Layer.provide(PtyTicket.defaultLayer),
  Layer.provide(LocationServiceMap.layer),
  Layer.provide(Credential.defaultLayer),
)
