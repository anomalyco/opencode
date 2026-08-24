import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer, Context } from "effect"
import { Config } from "@/config/config"

export interface Interface {
  readonly isEnabled: () => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/AutoMode") {}

// CLI override takes precedence over config for the lifetime of the process
let _cliOverride: boolean | undefined = undefined

export function setAutoMode(enabled: boolean): void {
  _cliOverride = enabled
}

export const layer: Layer.Layer<Service, never, Config.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service

    return Service.of({
      isEnabled: () =>
        Effect.gen(function* () {
          if (_cliOverride !== undefined) return _cliOverride
          const cfg = yield* config.get()
          return cfg.auto_mode ?? false
        }),
    })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Config.node],
})

export const defaultLayer = Layer.suspend(() => layer.pipe(Layer.provide(Config.defaultLayer)))

export const AutoMode = { Service, layer, node, defaultLayer, setAutoMode }
