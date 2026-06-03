export * as PluginV2 from "./plugin"

import { createDraft, finishDraft, type Draft } from "immer"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { Context, Effect, Exit, Layer, Schema, Scope } from "effect"
import type { ModelV2 } from "./model"
import type { Catalog } from "./catalog"
import { EventV2 } from "./event"

export const ID = Schema.String.pipe(Schema.brand("Plugin.ID"))
export type ID = typeof ID.Type

export const Event = {
  Added: EventV2.define({
    type: "plugin.added",
    schema: {
      id: ID,
    },
  }),
}

type HookSpec = {
  "catalog.transform": {
    input: Catalog.Editor
    output: {}
  }
  "account.switched": {
    input: {
      serviceID: import("./auth").Auth.ServiceID
      from?: import("./auth").Auth.ID
      to?: import("./auth").Auth.ID
    }
    output: {}
  }
  "aisdk.language": {
    input: {
      model: ModelV2.Info
      sdk: any
      options: Record<string, any>
    }
    output: {
      language?: LanguageModelV3
    }
  }
  "aisdk.sdk": {
    input: {
      model: ModelV2.Info
      package: string
      options: Record<string, any>
    }
    output: {
      sdk?: any
    }
  }
}

export type Hooks = {
  [Name in keyof HookSpec]: Readonly<HookSpec[Name]["input"]> & {
    -readonly [Field in keyof HookSpec[Name]["output"]]: HookSpec[Name]["output"][Field] extends object
      ? Draft<HookSpec[Name]["output"][Field]>
      : HookSpec[Name]["output"][Field]
  }
}

export type HookFunctions = {
  [key in keyof Hooks]?: (input: Hooks[key]) => Effect.Effect<void>
}

export type HookInput<Name extends keyof Hooks> = HookSpec[Name]["input"]
export type HookOutput<Name extends keyof Hooks> = HookSpec[Name]["output"]

export type Effect<R = never> = Effect.Effect<HookFunctions | void, never, R | Scope.Scope>

export function define<R>(input: { id: ID; effect: Effect.Effect<HookFunctions | void, never, R> }) {
  return input
}

export interface Interface {
  readonly add: (input: {
    id: ID
    effect: Effect.Effect<void | HookFunctions, never, Scope.Scope>
  }) => Effect.Effect<void, never, never>
  readonly remove: (id: ID) => Effect.Effect<void>
  readonly triggerFor: <Name extends keyof Hooks>(
    id: ID,
    name: Name,
    input: HookInput<Name>,
    output: HookOutput<Name>,
  ) => Effect.Effect<HookInput<Name> & HookOutput<Name>>
  readonly trigger: <Name extends keyof Hooks>(
    name: Name,
    input: HookInput<Name>,
    output: HookOutput<Name>,
  ) => Effect.Effect<HookInput<Name> & HookOutput<Name>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Plugin") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    let hooks: {
      id: ID
      hooks: HookFunctions
      scope: Scope.Closeable
    }[] = []
    const events = yield* EventV2.Service

    const svc = Service.of({
      add: Effect.fn("Plugin.add")(function* (input) {
        const existing = hooks.find((item) => item.id === input.id)
        if (existing) yield* Scope.close(existing.scope, Exit.void).pipe(Effect.ignore)
        const scope = yield* Scope.make()
        const result = yield* input.effect.pipe(
          Scope.provide(scope),
          Effect.withSpan("Plugin.load", {
            attributes: {
              "plugin.id": input.id,
            },
          }),
        )
        hooks = [
          ...hooks.filter((item) => item.id !== input.id),
          {
            id: input.id,
            hooks: result ?? {},
            scope,
          },
        ]
        yield* events.publish(Event.Added, { id: input.id })
      }),
      trigger: Effect.fn("Plugin.trigger")(function* (name, input, output) {
        return yield* svc.triggerFor(ID.make("*"), name, input, output)
      }),
      triggerFor: Effect.fn("Plugin.triggerFor")(function* (id, name, input, output) {
        const draftEntries = new Map<string, ReturnType<typeof createDraft>>()
        const event = {
          ...input,
          ...output,
        } as Record<string, unknown>

        for (const [field, value] of Object.entries(output)) {
          if (value && typeof value === "object") {
            draftEntries.set(field, createDraft(value))
            event[field] = draftEntries.get(field)
          }
        }

        for (const item of hooks) {
          if (id !== ID.make("*") && item.id !== id) continue
          const match = item.hooks[name]
          if (!match) continue
          yield* match(event as any).pipe(
            Effect.withSpan(`Plugin.hook.${name}`, {
              attributes: {
                plugin: item.id,
                hook: name,
              },
            }),
          )
        }

        for (const [field, draft] of draftEntries) {
          event[field] = finishDraft(draft)
        }

        return event as any
      }),
      remove: Effect.fn("Plugin.remove")(function* (id) {
        const existing = hooks.find((item) => item.id === id)
        hooks = hooks.filter((item) => item.id !== id)
        if (existing) yield* Scope.close(existing.scope, Exit.void).pipe(Effect.ignore)
      }),
    })
    return svc
  }),
)

export const locationLayer = layer

// opencode
// sdcok
