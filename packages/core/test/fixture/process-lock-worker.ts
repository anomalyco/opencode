import { ProcessLock } from "@opencode-ai/core/util/process-lock"
import { Effect, Schema } from "effect"
import fs from "node:fs/promises"

const input = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ file: Schema.String, ready: Schema.String })),
)(process.argv[2])

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      yield* ProcessLock.acquire(input.file)
      yield* Effect.promise(() => fs.writeFile(input.ready, String(process.pid)))
      return yield* Effect.never
    }),
  ),
)
