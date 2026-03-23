import { context, propagation } from "@opentelemetry/api"
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks"
import { W3CTraceContextPropagator } from "@opentelemetry/core"

let initialized = false

export namespace TelemetryBootstrap {
  export function init() {
    if (initialized) return
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable())
    propagation.setGlobalPropagator(new W3CTraceContextPropagator())
    initialized = true
  }
}
