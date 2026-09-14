export * as Settings from "./settings.js"
export { Target, Value, Entry, Event } from "@opencode/schema/settings"

import { Settings } from "@opencode/schema/settings"
import { Skill } from "@opencode/schema/skill"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { Bus } from "./bus.js"
import { KV } from "./kv.js"

const prefix = "settings:values:"
const key = (target: Settings.Target) => `${prefix}${JSON.stringify([target.kind, target.id])}`
const decode = Schema.decodeUnknownOption(Settings.Entry)

const definitions = new Map<string, Schema.Codec<Settings.Value, Settings.Value>>([
  ["skill.activation", Skill.Activation],
])

export class InvalidValueError extends Schema.TaggedError<InvalidValueError>()("Settings.InvalidValue", {
  target: Settings.Target,
  message: Schema.String,
}) {}

/** Global value overrides. Consumers own defaults, inventory, and the behavior each value controls. */
export interface Interface {
  readonly get: (target: Settings.Target) => Effect.Effect<Settings.Value | undefined>
  readonly list: () => Effect.Effect<Settings.Entry[]>
  readonly set: (target: Settings.Target, value: Settings.Value) => Effect.Effect<void, InvalidValueError>
  readonly reset: (target: Settings.Target) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Settings") {}

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
        get: Effect.fn("Settings.get")(function* (target) {
          return Option.getOrUndefined(read(yield* kv.get(key(target))))?.value
        }),
        list: Effect.fn("Settings.list")(function* () {
          const entries: Settings.Entry[] = []
          let after: string | undefined
          do {
            const page = yield* kv.scan({ prefix, after, limit: 1000 })
            entries.push(...page.entries.flatMap((entry) => Option.toArray(read(entry.value))))
            after = page.next
          } while (after !== undefined)
          return entries
        }),
        set: Effect.fn("Settings.set")(function* (target, value) {
          const schema = definitions.get(target.kind)
          if (!schema)
            return yield* new InvalidValueError({ target, message: `Unknown setting kind: ${target.kind}` })
          const decoded = yield* Schema.decodeUnknownEffect(schema)(value).pipe(
            Effect.mapError(
              (error) =>
                new InvalidValueError({ target, message: `Invalid value for ${target.kind}: ${error.message}` }),
            ),
          )
          yield* kv.set(key(target), { target, value: decoded })
          yield* bus.publish(Settings.Event.Updated, { target }, { global: true })
        }),
        reset: Effect.fn("Settings.reset")(function* (target) {
          yield* kv.remove(key(target))
          yield* bus.publish(Settings.Event.Updated, { target }, { global: true })
        }),
      })
    }),
  ),
})
