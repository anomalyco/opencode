import { Effect, Option, Schema } from "effect"
import { Instructions } from "@opencode-ai/core/instructions"

export interface State {
  readonly values: Readonly<Record<string, Schema.Json>>
}

export const state = (values: Readonly<Record<string, Schema.Json>>): State => ({ values })

const hashes = (values: Readonly<Record<string, Schema.Json>>): Instructions.Values =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Instructions.hash(value)]))

export const readInitial = (instructions: Instructions.Instructions) =>
  Effect.gen(function* () {
    const admission = yield* Instructions.read(instructions).pipe(Effect.flatMap(Instructions.diff))
    const current = state(
      Object.fromEntries(
        Object.entries(admission.delta).flatMap(([key, hash]) =>
          hash === "removed" ? [] : [[key, admission.blobs[hash]]],
        ),
      ),
    )
    return { ...current, text: Instructions.renderInitial(instructions, current.values) }
  })

export const readUpdate = (instructions: Instructions.Instructions, previous: State) =>
  Effect.gen(function* () {
    const admission = yield* Instructions.read(instructions).pipe(
      Effect.flatMap((observed) => Instructions.diff(observed, hashes(previous.values))),
    )
    const delta = Object.fromEntries(
      Object.entries(admission.delta).map(([key, hash]) => [
        key,
        hash === "removed" ? Option.none() : Option.some(admission.blobs[hash]),
      ]),
    ) as Readonly<Record<string, Option.Option<Schema.Json>>>
    const values = Instructions.applyDelta(previous.values, delta)
    return {
      values,
      text: Instructions.renderUpdate(instructions, previous.values, delta),
      changed: Object.keys(admission.delta).length > 0,
    }
  })
