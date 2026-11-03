import { migrate as drizzleMigrate } from "drizzle-orm/planetscale-serverless/migrator"
import { Config, ConfigProvider, Effect } from "effect"
import { DrizzleClient, layer } from "./database"

// The migrator reads migration files from disk, so it stays out of the
// Worker-safe database module.
class MigrationError extends Error {
  readonly _tag = "MigrationError"

  constructor(input: { message: string; cause?: unknown }) {
    super(input.message, { cause: input.cause })
    this.name = "MigrationError"
  }
}

const migrate = Effect.fn("Database.migrate")(function* () {
  const migrationsDir = yield* Config.NonEmptyString("DATABASE_MIGRATIONS_DIR")
    .pipe(Config.withDefault("./migrations"))
    .parse(ConfigProvider.fromEnv())
  const db = yield* DrizzleClient
  yield* Effect.logInfo("applying database migrations").pipe(Effect.annotateLogs({ migrationsDir }))
  const result = yield* Effect.tryPromise({
    try: () => drizzleMigrate(db, { migrationsFolder: migrationsDir }),
    catch: (cause) => new MigrationError({ message: "Failed to apply database migrations", cause }),
  })
  if (result)
    return yield* Effect.fail(
      new MigrationError({
        message: `Failed to initialize database migrations: ${result.exitCode}`,
      }),
    )
  yield* Effect.logInfo("database migrations complete").pipe(Effect.annotateLogs({ migrationsDir }))
})

await Effect.runPromise(migrate().pipe(Effect.provide(layer)))
