export * as ReferenceGuidance from "./guidance"

import { Context, Effect, Layer, Schema } from "effect"
import { Reference } from "../reference"
import { SystemContext } from "../system-context/index"

const Summary = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  description: Schema.String.pipe(Schema.optional),
})

const render = (references: ReadonlyArray<typeof Summary.Type>) =>
  [
    "Project references provide additional directories that can be accessed when relevant.",
    "<available_references>",
    ...references.flatMap((reference) => [
      "  <reference>",
      `    <name>${reference.name}</name>`,
      `    <path>${reference.path}</path>`,
      ...(reference.description === undefined ? [] : [`    <description>${reference.description}</description>`]),
      "  </reference>",
    ]),
    "</available_references>",
  ].join("\n")

export interface Interface {
  readonly load: () => Effect.Effect<SystemContext.SystemContext>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/ReferenceGuidance") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const references = yield* Reference.Service

    return Service.of({
      load: Effect.fn("ReferenceGuidance.load")(function* () {
        const available = (yield* references.list())
          .filter((reference) => reference.description !== undefined)
          .map((reference) => ({
            name: reference.name,
            path: reference.path,
            description: reference.description,
          }))
          .toSorted((a, b) => a.name.localeCompare(b.name))
        if (available.length === 0) return SystemContext.empty
        return SystemContext.make({
          key: SystemContext.Key.make("core/reference-guidance"),
          codec: Schema.toCodecJson(Schema.Array(Summary)),
          load: Effect.succeed(available),
          baseline: render,
          update: (_previous, current) =>
            [
              "The available project references have changed. This list supersedes the previous reference list.",
              render(current),
            ].join("\n"),
          removed: () => "Project reference guidance is no longer available. Do not use previously listed references.",
        })
      }),
    })
  }),
)

export const locationLayer = layer
