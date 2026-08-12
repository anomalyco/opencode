import { rm } from "node:fs/promises"
import * as Effect from "effect/Effect"
import {
  initializeInstance,
  prepareInstanceProject,
} from "../instance/instance.js"
import type {
  OpenCodeConfig,
  OpenCodeTuiConfig,
  Project as ProjectDefinition,
  Setup,
} from "../project.js"
import { error } from "./error.js"

export interface Options {
  readonly project?: ProjectDefinition
  readonly config?: OpenCodeConfig
  readonly tui?: OpenCodeTuiConfig
  readonly setup?: Setup
  /** Retain the isolated artifact directory after the scope closes. */
  readonly keepArtifacts?: boolean
}

export interface Project {
  readonly artifacts: string
}

export const make = Effect.fn("OpenCodeProject.make")(function* (
  options: Options = {},
) {
  const artifacts = yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: () => initializeInstance(),
      catch: (cause) => error("project.initialize", cause),
    }),
    (directory) =>
      options.keepArtifacts
        ? Effect.void
        : Effect.tryPromise({
            try: () => rm(directory, { recursive: true, force: true }),
            catch: () => undefined,
          }).pipe(Effect.ignore),
  )
  yield* prepareInstanceProject({
    artifacts,
    project: options.project,
    config: options.config,
    tui: options.tui,
    setup: options.setup,
  }).pipe(
    Effect.mapError((cause) => error("project.prepare", cause)),
  )
  return { artifacts }
})

export * as OpenCodeProject from "./project.js"
