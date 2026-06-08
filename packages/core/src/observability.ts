export * as Observability from "./observability"

import { Layer } from "effect"
import { Logging } from "./observability/logging"
import { Otlp } from "./observability/otlp"

export const enabled = Otlp.enabled
export const layer = enabled ? Otlp.layer.pipe(Layer.provideMerge(Logging.layer)) : Logging.layer
export const fileLogger = Logging.fileLogger
export const resource = Otlp.resource
