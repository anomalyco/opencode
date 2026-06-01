import { SessionV2 } from "@opencode-ai/core/session"
import { LocationServiceMap } from "@opencode-ai/core/location-layer"
import { Layer } from "effect"
import { layer as v2LocationLayer } from "../groups/v2/location"
import { messageHandlers } from "./v2/message"
import { modelHandlers } from "./v2/model"
import { providerHandlers } from "./v2/provider"
import { sessionHandlers } from "./v2/session"
import { permissionHandlers, sessionPermissionHandlers } from "./v2/permission"

export const v2Handlers = Layer.mergeAll(
  sessionHandlers,
  messageHandlers,
  modelHandlers,
  providerHandlers,
  permissionHandlers,
  sessionPermissionHandlers,
).pipe(
  Layer.provide(v2LocationLayer),
  Layer.provide(LocationServiceMap.layer),
  Layer.provide(SessionV2.defaultLayer),
)
