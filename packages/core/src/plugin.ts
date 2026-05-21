export * as PluginV2 from "./plugin"

import { createDraft, finishDraft, type Draft } from "immer"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { Context, Effect, Exit, Layer, PubSub, Schema, Scope, Stream } from "effect"
import type { ModelV2 } from "./model"
import type { AgentV2 } from "./agent"
import type { Catalog } from "./catalog"

export const ID = Schema.String.pipe(Schema.brand("Plugin.ID"))
export type ID = typeof ID.Type

type HookSpec = {
  "catalog.transform": {
    input: Catalog.Context
    output: {}
  }
  "account.switched": {
    input: {
      serviceID: import("./account").AccountV2.ServiceID
      from?: import("./account").AccountV2.ID
      to?: import("./account").AccountV2.ID
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
  "agent.update": {
    input: {}
    output: {
      agent: AgentV2.Info
      cancel: boolean
    }
  }
  "agent.remove": {
    input: {
      agent: AgentV2.Info
    }
    output: {
      cancel: boolean
    }
  }
  "agent.default": {
    input: {}
    output: {
      agent?: AgentV2.ID
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
  readonly added: () => Stream.Stream<ID>
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
    const added = yield* PubSub.unbounded<ID>()

    yield* Effect.addFinalizer(() => PubSub.shutdown(added))

    const svc = Service.of({
      add: Effect.fn("Plugin.add")(function* (input) {
        const existing = hooks.find((item) => item.id === input.id)
        if (existing) yield* Scope.close(existing.scope, Exit.void).pipe(Effect.ignore)
        const scope = yield* Scope.make()
        const result = yield* input.effect.pipe(Scope.provide(scope))
        hooks = [
          ...hooks.filter((item) => item.id !== input.id),
          {
            id: input.id,
            hooks: result ?? {},
            scope,
          },
        ]
        yield* PubSub.publish(added, input.id)
      }),
      added: () => Stream.fromPubSub(added),
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

export const defaultLayer = layer

// opencode
// sdcok
