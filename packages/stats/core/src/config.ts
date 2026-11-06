import { Config, ConfigProvider, Effect, Layer, Schema } from "effect"
import * as Context from "effect/Context"
import { Resource } from "sst/resource"

export class AppConfigValue extends Schema.Class<AppConfigValue>("AppConfigValue")({
  stage: Schema.NonEmptyString,
  publicUrl: Schema.NonEmptyString,
}) {}

const decodeAppConfigValue = Schema.decodeUnknownSync(AppConfigValue)

// Read the linked stage lazily, so importing this module in a Worker does not
// touch bindings at module scope.
const config = Config.all({
  publicUrl: Config.String("PUBLIC_URL").pipe(Config.withDefault("http://localhost:3000")),
}).pipe(Config.map((value) => decodeAppConfigValue({ ...value, stage: Resource.App.stage })))

export class AppConfig extends Context.Service<AppConfig, AppConfigValue>()("@opencode/stats/AppConfig") {
  static readonly config = config
  static readonly layer: Layer.Layer<AppConfig, never, never> = Layer.effect(
    AppConfig,
    config.parse(ConfigProvider.fromEnv()).pipe(Effect.orDie),
  )
}
