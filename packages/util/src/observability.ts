export * as Observability from "./observability"

import { NodeFileSystem } from "@effect/platform-node"
import { LayerNode } from "./effect/layer-node"
import { Effect, Layer, Logger, References, Schema } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { OtlpSerialization } from "effect/unstable/observability"
import { Logging } from "./observability/logging"
import { Otlp } from "./observability/otlp"

export const Options = Schema.Struct({
  endpoint: Schema.optional(Schema.String),
  headers: Schema.optional(Schema.String),
  client: Schema.optional(Schema.String),
})
export type Options = typeof Options.Type

export function layer(
  options: Options = {
    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    headers: process.env.OTEL_EXPORTER_OTLP_HEADERS,
    client: process.env.OPENCODE_CLIENT ?? "cli",
  },
) {
  const local = Logger.layer(Logging.loggers(), { mergeWithExisting: false }).pipe(
    Layer.provide(NodeFileSystem.layer),
    Layer.orDie,
    Layer.merge(Layer.succeed(References.MinimumLogLevel, Logging.minimumLogLevel())),
  )
  return Layer.unwrap(
    Effect.gen(function* () {
      const logs = Logger.layer([...Logging.loggers(), ...Otlp.loggers(options)], { mergeWithExisting: false }).pipe(
        Layer.provide(NodeFileSystem.layer),
        Layer.provide(OtlpSerialization.layerJson),
        Layer.provide(FetchHttpClient.layer),
        Layer.orDie,
        Layer.merge(Layer.succeed(References.MinimumLogLevel, Logging.minimumLogLevel())),
      )
      return Layer.merge(logs, yield* Effect.promise(() => Otlp.tracingLayer(options)))
    }),
  ).pipe(Layer.catchCause(() => local))
}

export const node = LayerNode.make({ name: "observability", layer: layer(), deps: [] })
