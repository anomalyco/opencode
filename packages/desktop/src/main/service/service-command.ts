import { Effect, FileSystem, Schema } from "effect"

const Config = Schema.Struct({
  command: Schema.optional(Schema.Array(Schema.NonEmptyString).check(Schema.isMinLength(1))),
})

// Read the native CLI configuration without returning or logging its private credential.
export const serviceCommand = Effect.fn("Desktop.serviceCommand")(function* (file: string) {
  const fs = yield* FileSystem.FileSystem
  if (!(yield* fs.exists(file))) return
  const text = yield* fs.readFileString(file)
  const config = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Config))(text).pipe(
    Effect.catch(() => Effect.fail(new Error("Invalid service startup command configuration"))),
  )
  return config.command
})
