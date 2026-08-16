import { Config, ConfigProvider, Effect, Layer, Schema } from "effect"
import * as Context from "effect/Context"
import { Resource } from "sst/resource"

export class AppConfigValue extends Schema.Class<AppConfigValue>("AppConfigValue")({
  stage: Schema.NonEmptyString,
  publicUrl: Schema.NonEmptyString,
}) {}

const decodeAppConfigValue = Schema.decodeUnknownSync(AppConfigValue)

const config = Config.all({
  stage: Config.succeed(Resource.App.stage),
  publicUrl: Config.string("PUBLIC_URL").pipe(Config.withDefault("http://localhost:3000")),
}).pipe(Config.map(decodeAppConfigValue))

export class AppConfig extends Context.Service<AppConfig, AppConfigValue>()("@opencode/stats/AppConfig") {
  static readonly config = config
  static readonly layer: Layer.Layer<AppConfig, never, never> = Layer.effect(
    AppConfig,
    config.parse(ConfigProvider.fromEnv()).pipe(Effect.orDie),
  )
}
