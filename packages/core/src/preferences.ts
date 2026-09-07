export * as Preferences from "./preferences.js"
export { Target, Value, Entry, Event } from "@opencode-ai/schema/preferences"

import { Preferences } from "@opencode-ai/schema/preferences"
import { Skill } from "@opencode-ai/schema/skill"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { Bus } from "./bus.js"
import { KV } from "./kv.js"

const prefix = "preferences:values:"
const key = (target: Preferences.Target) => `${prefix}${JSON.stringify([target.kind, target.id])}`
const decode = Schema.decodeUnknownOption(Preferences.Entry)

const definitions = new Map<string, Schema.Codec<Preferences.Value, Preferences.Value>>([
  ["skill.activation", Skill.Activation],
])

export class InvalidValueError extends Schema.TaggedError<InvalidValueError>()("Preferences.InvalidValue", {
  target: Preferences.Target,
  message: Schema.String,
}) {}

/** Global value overrides. Consumers own defaults, inventory, and the behavior each value controls. */
export interface Interface {
  readonly get: (target: Preferences.Target) => Effect.Effect<Preferences.Value | undefined>
  readonly list: () => Effect.Effect<Preferences.Entry[]>
  readonly set: (target: Preferences.Target, value: Preferences.Value) => Effect.Effect<void, InvalidValueError>
  readonly reset: (target: Preferences.Target) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Preferences") {}

export const node = makeGlobalNode({
  service: Service,
  deps: [KV.node, Bus.node],
  layer: Layer.effect(
    Service,
    Effect.gen(function* () {
      const kv = yield* KV.Service
      const bus = yield* Bus.Service
      const read = (value: unknown) =>
        Option.flatMap(decode(value), (entry) => {
          const schema = definitions.get(entry.target.kind)
          if (!schema || !Schema.is(schema)(entry.value)) return Option.none()
          return Option.some(entry)
        })

      return Service.of({
        get: Effect.fn("Preferences.get")(function* (target) {
          return Option.getOrUndefined(read(yield* kv.get(key(target))))?.value
        }),
        list: Effect.fn("Preferences.list")(function* () {
          const entries: Preferences.Entry[] = []
          let after: string | undefined
          do {
            const page = yield* kv.scan({ prefix, after, limit: 1000 })
            entries.push(...page.entries.flatMap((entry) => Option.toArray(read(entry.value))))
            after = page.next
          } while (after !== undefined)
          return entries
        }),
        set: Effect.fn("Preferences.set")(function* (target, value) {
          const schema = definitions.get(target.kind)
          if (!schema)
            return yield* new InvalidValueError({ target, message: `Unknown preference kind: ${target.kind}` })
          const decoded = yield* Schema.decodeUnknownEffect(schema)(value).pipe(
            Effect.mapError(
              (error) =>
                new InvalidValueError({ target, message: `Invalid value for ${target.kind}: ${error.message}` }),
            ),
          )
          yield* kv.set(key(target), { target, value: decoded })
          yield* bus.publish(Preferences.Event.Updated, { target }, { global: true })
        }),
        reset: Effect.fn("Preferences.reset")(function* (target) {
          yield* kv.remove(key(target))
          yield* bus.publish(Preferences.Event.Updated, { target }, { global: true })
        }),
      })
    }),
  ),
})
