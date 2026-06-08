export * as Observability from "./observability"

import { Logging } from "./observability/logging"
import { Otlp } from "./observability/otlp"

export const enabled = Otlp.enabled
export const layer = enabled ? Otlp.layer : Logging.layer
export const fileLogger = Logging.fileLogger
export const resource = Otlp.resource
