export * as ReferenceGuidance from "./guidance"

import { makeLocationNode } from "../effect/app-node"
import { Context, Effect, Layer, Schema } from "effect"
import { Reference } from "../reference"
import { SystemContext } from "../system-context/index"

const Summary = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  description: Schema.String.pipe(Schema.optional),
})

const entries = (references: ReadonlyArray<typeof Summary.Type>) =>
  references.flatMap((reference) => [
    "  <reference>",
    `    <name>${reference.name}</name>`,
    `    <path>${reference.path}</path>`,
    ...(reference.description === undefined ? [] : [`    <description>${reference.description}</description>`]),
    "  </reference>",
  ])

const render = (references: ReadonlyArray<typeof Summary.Type>) =>
  [
    "Project references provide additional directories that can be accessed when relevant.",
    "<available_references>",
    ...entries(references),
    "</available_references>",
  ].join("\n")

const update = (previous: ReadonlyArray<typeof Summary.Type>, current: ReadonlyArray<typeof Summary.Type>) => {
  const names = new Set(current.map((reference) => reference.name))
  const previousByName = new Map(previous.map((reference) => [reference.name, reference]))
  const added = current.filter((reference) => !previousByName.has(reference.name))
  const removed = previous.filter((reference) => !names.has(reference.name))
  const changed = current.filter((reference) => {
    const before = previousByName.get(reference.name)
    return before !== undefined && (before.path !== reference.path || before.description !== reference.description)
  })
  // Additions and removals render as small deltas; anything else restates the full list.
  if (changed.length > 0 || (added.length === 0 && removed.length === 0))
    return [
      "The available project references have changed. This list supersedes the previous reference list.",
      render(current),
    ].join("\n")
  return [
    ...(added.length === 0
      ? []
      : ["New project references are available in addition to those previously listed:", ...entries(added)]),
    ...(removed.length === 0
      ? []
      : [
          `The following project references are no longer available and must not be used: ${removed.map((reference) => reference.name).join(", ")}.`,
        ]),
  ].join("\n")
}

export interface Interface {
  readonly load: () => Effect.Effect<SystemContext.SystemContext>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/ReferenceGuidance") {}

const layer = Layer.effect(
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
          update,
          removed: () => "Project reference guidance is no longer available. Do not use previously listed references.",
        })
      }),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Reference.node] })
