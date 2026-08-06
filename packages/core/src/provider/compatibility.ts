export * as ProviderCompatibility from "./compatibility"

import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { Context, Effect, Layer } from "effect"
import { Catalog } from "../catalog"
import { Config } from "../config"
import { ConfigPolicyPlugin } from "../config/plugin/policy"
import { Model } from "../model"
import { Provider } from "../provider"

export type Mode = "configured" | "available"
export type Via = "exact" | "legacy-provider"

export type Selection =
  | { readonly type: "exact"; readonly model: Model.Info; readonly requested: Model.Ref }
  | { readonly type: "legacy-provider"; readonly model: Model.Info; readonly requested: Model.Ref }
  | { readonly type: "fallback-blocked" }
  | { readonly type: "absent" }

export interface Interface {
  readonly select: (requested: Model.Ref, mode: Mode) => Effect.Effect<Selection>
  readonly default: () => Effect.Effect<{
    readonly model: Model.Info
    readonly requested?: Model.Ref
    readonly via?: Via
  } | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ProviderCompatibility") {}

const aliases = new Map<Provider.ID, Provider.ID>([
  [Provider.ID.make("azure-cognitive-services"), Provider.ID.azure],
  [Provider.ID.make("google-vertex-anthropic"), Provider.ID.make("google-vertex")],
])

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const catalog = yield* Catalog.Service
    const config = yield* Config.Service

    const find = Effect.fn("ProviderCompatibility.find")(function* (ref: Model.Ref, mode: Mode) {
      if (mode === "configured") return yield* catalog.model.get(ref.providerID, ref.id)
      return (yield* catalog.model.available()).find(
        (model) => model.providerID === ref.providerID && model.id === ref.id,
      )
    })

    const select: Interface["select"] = Effect.fn("ProviderCompatibility.select")(function* (requested, mode) {
      const exact = yield* find(requested, mode)
      if (exact) return { type: "exact", model: exact, requested }
      if (yield* catalog.provider.claimed(requested.providerID)) return { type: "fallback-blocked" }

      const target = aliases.get(requested.providerID)
      if (!target) return { type: "absent" }
      const policy = ConfigPolicyPlugin.compatibility(
        ConfigPolicyPlugin.effective(yield* config.entries()),
        requested.providerID,
        target,
      )
      if (policy === "source-denied") return { type: "fallback-blocked" }
      if (policy === "target-denied") return { type: "absent" }

      const selected = yield* find(Model.Ref.make({ ...requested, providerID: target }), mode)
      if (!selected) return { type: "absent" }
      return { type: "legacy-provider", model: selected, requested }
    })
    return Service.of({
      select,
      default: Effect.fn("ProviderCompatibility.default")(function* () {
        const configured = yield* catalog.model.configured()
        if (configured) {
          const requested = Model.Ref.make({
            providerID: configured.providerID,
            id: configured.modelID,
            ...(configured.variant === undefined ? {} : { variant: configured.variant }),
          })
          const selection = yield* select(requested, "available")
          if (
            (selection.type === "exact" || selection.type === "legacy-provider") &&
            Boolean(selection.model.package)
          )
            return { model: selection.model, requested: selection.requested, via: selection.type }
        }
        const model = (yield* catalog.model.available()).find((model) => Boolean(model.package))
        if (model) return { model }
      }),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Catalog.node, Config.node] })
