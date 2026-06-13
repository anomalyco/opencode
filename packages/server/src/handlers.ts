import { SessionV2 } from "@cedric/core/session"
import { LocationServiceMap } from "@cedric/core/location-layer"
import { PermissionSaved } from "@cedric/core/permission/saved"
import { Layer } from "effect"
import { layer as v2LocationLayer } from "./groups/v2/location"
import { messageHandlers } from "./handlers/v2/message"
import { modelHandlers } from "./handlers/v2/model"
import { providerHandlers } from "./handlers/v2/provider"
import { sessionHandlers } from "./handlers/v2/session"
import { permissionHandlers, savedPermissionHandlers, sessionPermissionHandlers } from "./handlers/v2/permission"
import { fileSystemHandlers } from "./handlers/v2/fs"
import { commandHandlers } from "./handlers/v2/command"
import { skillHandlers } from "./handlers/v2/skill"
import { eventHandlers } from "./handlers/v2/event"
import { agentHandlers } from "./handlers/v2/agent"
import { healthHandlers } from "./handlers/v2/health"
import { questionHandlers, sessionQuestionHandlers } from "./handlers/v2/question"
import { Database } from "@cedric/core/database/database"
import { EventV2 } from "@cedric/core/event"
import { ProjectV2 } from "@cedric/core/project"
import * as SessionExecutionLocal from "@cedric/core/session/execution/local"
import { SessionProjector } from "@cedric/core/session/projector"
import { SessionStore } from "@cedric/core/session/store"

const routedSessions = SessionV2.layer.pipe(
  Layer.provide(SessionProjector.layer),
  Layer.provide(SessionExecutionLocal.layer),
  Layer.provide(LocationServiceMap.layer),
  Layer.provide(SessionStore.layer),
  Layer.provide(EventV2.layer),
  Layer.provide(Database.defaultLayer),
  Layer.provide(ProjectV2.defaultLayer),
  Layer.orDie,
)

export const v2Handlers = Layer.mergeAll(
  healthHandlers,
  agentHandlers,
  sessionHandlers,
  messageHandlers,
  modelHandlers,
  providerHandlers,
  permissionHandlers,
  sessionPermissionHandlers,
  savedPermissionHandlers,
  fileSystemHandlers,
  commandHandlers,
  skillHandlers,
  eventHandlers,
  questionHandlers,
  sessionQuestionHandlers,
).pipe(
  Layer.provide(v2LocationLayer),
  Layer.provide(LocationServiceMap.layer),
  Layer.provide(PermissionSaved.layer),
  Layer.provide(routedSessions),
)
