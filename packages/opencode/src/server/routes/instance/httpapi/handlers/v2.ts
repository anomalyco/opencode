import { SessionV2 } from "@/v2/session"
import { Layer } from "effect"
import { layer as v2InstanceLayer } from "../groups/v2/instance"
import { messageHandlers } from "./v2/message"
import { modelHandlers } from "./v2/model"
import { providerHandlers } from "./v2/provider"
import { sessionHandlers } from "./v2/session"

export const v2Handlers = Layer.mergeAll(sessionHandlers, messageHandlers, modelHandlers, providerHandlers).pipe(
  Layer.provide(v2InstanceLayer),
  Layer.provide(SessionV2.defaultLayer),
)
