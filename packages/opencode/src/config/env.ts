export * as ConfigEnv from "./env"

import { Config as EffectConfig, ConfigProvider, Context, Effect, Layer } from "effect"
import { ConfigService } from "@/effect/config-service"

const fields = {
  config: EffectConfig.string("OPENCODE_CONFIG").pipe(EffectConfig.option),
  configDir: EffectConfig.string("OPENCODE_CONFIG_DIR").pipe(EffectConfig.option),
  inlineConfigContent: EffectConfig.string("OPENCODE_CONFIG_CONTENT").pipe(EffectConfig.option),
  disableProjectConfig: EffectConfig.boolean("OPENCODE_DISABLE_PROJECT_CONFIG").pipe(EffectConfig.withDefault(false)),
  permission: EffectConfig.string("OPENCODE_PERMISSION").pipe(EffectConfig.option),
}

export class Service extends ConfigService.Service<Service>()("@opencode/ConfigEnv", fields) {}

export type Info = Context.Service.Shape<typeof Service>

export const layer = (input: Info) => Service.layer(input)
// Build the env-backed provider inside the layer so each layer construction sees
// the current process env instead of a module-load snapshot.
export const defaultLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* EffectConfig.all(fields).pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv())))
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Config.all preserves the declared field shape.
    return Service.of(config as Info)
  }),
).pipe(Layer.orDie)
