import { Client } from "@planetscale/database"
import { drizzle } from "drizzle-orm/planetscale-serverless"
import { migrate as drizzleMigrate } from "drizzle-orm/planetscale-serverless/migrator"
import { Config, ConfigProvider, Effect, Layer, Schema } from "effect"
import * as Context from "effect/Context"
import * as schema from "./database/schema"
import { Resource } from "sst/resource"

export const DatabaseUrl = Schema.NonEmptyString.pipe(Schema.brand("DatabaseUrl"))
export type DatabaseUrl = typeof DatabaseUrl.Type

export class DatabaseSettings extends Schema.Class<DatabaseSettings>("DatabaseSettings")({
  url: DatabaseUrl,
  migrationsDir: Schema.NonEmptyString,
}) {}

const decodeDatabaseSettings = Schema.decodeUnknownSync(DatabaseSettings)

const config = Config.all({
  url: Config.nonEmptyString("DATABASE_URL").pipe(Config.withDefault(Resource.StatsDatabase.url)),
  migrationsDir: Config.nonEmptyString("DATABASE_MIGRATIONS_DIR").pipe(Config.withDefault("./migrations")),
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
  return drizzle({ client: new Client({ url: settings.url }), schema })
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

export class MigrationError extends Error {
  readonly _tag = "MigrationError"

  constructor(input: { message: string; cause?: unknown }) {
    super(input.message, { cause: input.cause })
    this.name = "MigrationError"
  }
}

export const migrate = Effect.fn("Database.migrate")(function* () {
  const settings = yield* DatabaseConfig
  yield* Effect.logInfo("applying database migrations").pipe(
    Effect.annotateLogs({ migrationsDir: settings.migrationsDir }),
  )
  const result = yield* Effect.tryPromise({
    try: () =>
      drizzleMigrate(drizzle({ client: new Client({ url: settings.url }) }), {
        migrationsFolder: settings.migrationsDir,
      }),
    catch: (cause) => new MigrationError({ message: "Failed to apply database migrations", cause }),
  })
  if (result)
    return yield* Effect.fail(
      new MigrationError({
        message: `Failed to initialize database migrations: ${result.exitCode}`,
      }),
    )
  yield* Effect.logInfo("database migrations complete").pipe(
    Effect.annotateLogs({ migrationsDir: settings.migrationsDir }),
  )
})

export const layer = Layer.mergeAll(DatabaseConfig.layer, DrizzleClient.layer.pipe(Layer.provide(DatabaseConfig.layer)))
