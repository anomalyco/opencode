import { Client } from "@planetscale/database"
import { drizzle } from "drizzle-orm/planetscale-serverless"
import { Config, ConfigProvider, Effect, Layer, Option, Schema } from "effect"
import * as Context from "effect/Context"
import { Resource } from "./resource"

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
    Config.map(Option.getOrElse(() => Resource.DataDatabase.url)),
  ),
}).pipe(Config.map(decodeDatabaseSettings))

export class DatabaseConfig extends Context.Service<DatabaseConfig, DatabaseSettings>()(
  "@opencode/data/DatabaseConfig",
) {
  static readonly config = config
  static readonly layer: Layer.Layer<DatabaseConfig, never, never> = Layer.effect(
    DatabaseConfig,
    config.parse(ConfigProvider.fromEnv()).pipe(Effect.orDie),
  )
}

// Each request is one statement (a transaction is several), so this bounds a
// single upsert chunk, not a whole write. A 500-row upsert normally finishes in
// seconds; without a bound, a hung request holds the step until its 30-minute timeout.
const DATABASE_REQUEST_TIMEOUT_MS = 60_000

function makeDrizzle(settings: DatabaseSettings) {
  return drizzle({
    client: new Client({
      url: settings.url,
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(DATABASE_REQUEST_TIMEOUT_MS) }),
    }),
  })
}

export type Drizzle = ReturnType<typeof makeDrizzle>

export class DrizzleClient extends Context.Service<DrizzleClient, Drizzle>()("@opencode/data/DrizzleClient") {
  static readonly layer: Layer.Layer<DrizzleClient, never, DatabaseConfig> = Layer.effect(
    DrizzleClient,
    Effect.map(DatabaseConfig, makeDrizzle),
  )
}

export class DatabaseError extends Error {
  readonly _tag = "DatabaseError"

  constructor(input: { cause: unknown }) {
    const reason = rootCause(input.cause)
    super(reason instanceof Error ? `Database operation failed: ${reason.toString()}` : "Database operation failed", {
      cause: input.cause,
    })
    this.name = "DatabaseError"
  }

  static make(input: { cause: unknown }) {
    return new DatabaseError(input)
  }
}

// Drizzle wraps the driver's error in one whose message holds the whole query and
// its parameters, which for an upsert chunk is hundreds of rows. Name the driver's error.
function rootCause(cause: unknown): unknown {
  return cause instanceof Error && cause.cause !== undefined ? rootCause(cause.cause) : cause
}

export const catchDbError = Effect.mapError((cause) => DatabaseError.make({ cause }))

export const layer = Layer.mergeAll(DatabaseConfig.layer, DrizzleClient.layer.pipe(Layer.provide(DatabaseConfig.layer)))
