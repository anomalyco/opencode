export * as Observability from "./observability.js"

import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import { LayerNode } from "./effect/layer-node.js"
import { Effect, Layer, Logger, References, Schema } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { OtlpExporter, OtlpSerialization } from "effect/unstable/observability"
import { Logging } from "./observability/logging.js"
import { Otlp } from "./observability/otlp.js"

export const Options = Schema.Struct({
  endpoint: Schema.optional(Schema.String),
  headers: Schema.optional(Schema.String),
  client: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  channel: Schema.optional(Schema.String),
})
export type Options = typeof Options.Type

export function layer(
  options: Options = {
    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    headers: process.env.OTEL_EXPORTER_OTLP_HEADERS,
  },
) {
  const app = {
    client: options.client ?? "opencode",
    version: options.version ?? "unknown",
    channel: options.channel ?? "local",
  }
  const local = Logger.layer(Logging.loggers(app.channel === "local", app.channel), { mergeWithExisting: false }).pipe(
    Layer.provide(NodeFileSystem.layer),
    Layer.orDie,
    Layer.merge(Layer.succeed(References.MinimumLogLevel, Logging.minimumLogLevel())),
  )
  return Layer.unwrap(
    Effect.gen(function* () {
      const logs = Logger.layer(
        [...Logging.loggers(app.channel === "local", app.channel), ...Otlp.loggers(options, app)],
        { mergeWithExisting: false },
      ).pipe(
        Layer.provide(NodeFileSystem.layer),
        Layer.provide(OtlpSerialization.layerJson),
        Layer.provide(FetchHttpClient.layer),
        Layer.provide(OtlpExporter.layerFlusher),
        Layer.orDie,
        Layer.merge(Layer.succeed(References.MinimumLogLevel, Logging.minimumLogLevel())),
      )
      return Layer.merge(logs, yield* Otlp.tracingLayer(options, app))
    }),
  ).pipe(Layer.catchCause(() => local))
}

// Layer.suspend: constructing the loggers eagerly at module scope performs
// I/O (file logger, run id) that workerd forbids in global scope.
export const node = LayerNode.make({
  name: "observability",
  layer: Layer.suspend(() => layer()),
  deps: [],
})
