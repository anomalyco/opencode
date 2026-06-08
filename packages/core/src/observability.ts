export * as Observability from "./observability"

import { NodeFileSystem } from "@effect/platform-node"
import { Effect, Layer, Logger, References } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { OtlpSerialization } from "effect/unstable/observability"
import { Logging } from "./observability/logging"
import { Otlp } from "./observability/otlp"

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const logs = Logger.layer([...Logging.loggers(), ...Otlp.loggers()], { mergeWithExisting: false }).pipe(
      Layer.provide(NodeFileSystem.layer),
      Layer.provide(OtlpSerialization.layerJson),
      Layer.provide(FetchHttpClient.layer),
      Layer.orDie,
      Layer.merge(Layer.succeed(References.MinimumLogLevel, Logging.minimumLogLevel())),
    )
    return Layer.merge(logs, yield* Effect.promise(Otlp.tracingLayer))
  }),
)
