export * as Observability from "./observability"

import { Logging } from "./logging"
import { Otlp } from "./otlp"

export const enabled = Otlp.enabled
export const layer = enabled ? Otlp.layer : Logging.layer
export const fileLogger = Logging.fileLogger
export const resource = Otlp.resource
