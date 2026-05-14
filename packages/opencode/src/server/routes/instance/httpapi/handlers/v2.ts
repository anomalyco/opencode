import { Catalog } from "@opencode-ai/core/catalog"
import { Instance } from "@opencode-ai/core/instance"
import { SessionV2 } from "@/v2/session"
import { Layer } from "effect"
import { messageHandlers } from "./v2/message"
import { modelHandlers } from "./v2/model"
import { providerHandlers } from "./v2/provider"
import { sessionHandlers } from "./v2/session"

export const v2Handlers = Layer.mergeAll(sessionHandlers, messageHandlers, modelHandlers, providerHandlers).pipe(
  Layer.provide(
    Catalog.defaultLayer.pipe(
      Layer.provide(Layer.succeed(Instance.Service, Instance.Service.of({ directory: process.cwd() }))),
    ),
  ),
  Layer.provide(SessionV2.defaultLayer),
)
