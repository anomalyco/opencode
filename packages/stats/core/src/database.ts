import { Client } from "@planetscale/database"
import { drizzle } from "drizzle-orm/planetscale-serverless"
import { Config, ConfigProvider, Effect, Layer, Option, Schema } from "effect"
import * as Context from "effect/Context"
import { Resource } from "sst/resource"

export const DatabaseUrl = Schema.NonEmptyString.pipe(Schema.brand("DatabaseUrl"))
export type DatabaseUrl = typeof DatabaseUrl.Type

export class DatabaseSettings extends Schema.Class<DatabaseSettings>("DatabaseSettings")({
  url: DatabaseUrl,
}) {}

const decodeDatabaseSettings = Schema.decodeUnknownSync(DatabaseSettings)

const config = Config.all({
  // Read the linked database lazily, so importing this module in a Worker does not
  // touch bindings at module scope.
  url: Config.NonEmptyString("DATABASE_URL").pipe(
    Config.option,
    Config.map(Option.getOrElse(() => Resource.StatsDatabase.url)),
  ),
}).pipe(Config.map(decodeDatabaseSettings))

export class DatabaseConfig extends Context.Service<DatabaseConfig, DatabaseSettings>()(
  "@opencode/stats/DatabaseConfig",
) {
  static readonly config = config
  static readonly layer: Layer.Layer<DatabaseConfig, never, never> = Layer.effect(
    DatabaseConfig,
    config.parse(ConfigProvider.fromEnv()).pipe(Effect.orDie),
  )
}

function makeDrizzle(settings: DatabaseSettings) {
  return drizzle({ client: new Client({ url: settings.url }) })
}

export type Drizzle = ReturnType<typeof makeDrizzle>

export class DrizzleClient extends Context.Service<DrizzleClient, Drizzle>()("@opencode/stats/DrizzleClient") {
  static readonly layer: Layer.Layer<DrizzleClient, never, DatabaseConfig> = Layer.effect(
    DrizzleClient,
    Effect.map(DatabaseConfig, makeDrizzle),
  )
}

export class DatabaseError extends Error {
  readonly _tag = "DatabaseError"

  constructor(input: { cause: unknown }) {
    super("Database operation failed", { cause: input.cause })
    this.name = "DatabaseError"
  }

  static make(input: { cause: unknown }) {
    return new DatabaseError(input)
  }
}

export const catchDbError = Effect.mapError((cause) => DatabaseError.make({ cause }))

export const layer = Layer.mergeAll(DatabaseConfig.layer, DrizzleClient.layer.pipe(Layer.provide(DatabaseConfig.layer)))
