export * as ConfigPersistence from "./persist"

import { randomUUID } from "crypto"
import { Effect, FileSystem, Option } from "effect"
import path from "path"

export const write = Effect.fn("cli.config.persist")(function* (file: string, text: string) {
  const fs = yield* FileSystem.FileSystem
  const link = yield* fs.readLink(file).pipe(Effect.option)
  const target = Option.isSome(link) ? yield* fs.realPath(file) : file
  const temp = `${target}.${process.pid}.${randomUUID()}.tmp`

  yield* Effect.gen(function* () {
    yield* fs.makeDirectory(path.dirname(target), { recursive: true })
    yield* fs.writeFileString(temp, text, { mode: 0o600 })
    yield* fs.rename(temp, target)
  }).pipe(Effect.ensuring(fs.remove(temp).pipe(Effect.ignore)))
})
