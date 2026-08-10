import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Environment } from "@opencode-ai/core/environment"
import { Location } from "@opencode-ai/core/location"
import { Effect, Layer } from "effect"

export type EnvironmentFilesTransform = (files: Environment.Files) => Partial<Environment.Files>

export function transformEnvironmentFiles(
  location: Layer.Layer<Location.Service>,
  transform: EnvironmentFilesTransform = () => ({}),
) {
  return Layer.effect(
    Environment.Service,
    Effect.gen(function* () {
      const current = yield* Environment.Service
      return Environment.Service.of({
        ...current,
        files: { ...current.files, ...transform(current.files) },
      })
    }),
  ).pipe(Layer.provide(AppNodeBuilder.build(Environment.node, [[Location.node, location]])))
}
