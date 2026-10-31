export * as ConfigPersistence from "./persist"

import { randomUUID } from "crypto"
import { Effect, FileSystem, Option } from "effect"
import path from "path"

export const write = Effect.fn("cli.config.persist")(function* (file: string, text: string) {
  const fs = yield* FileSystem.FileSystem
  const target = yield* resolveTarget(fs, file)
  const temp = `${target}.${process.pid}.${randomUUID()}.tmp`

  yield* Effect.gen(function* () {
    yield* fs.makeDirectory(path.dirname(target), { recursive: true })
    yield* fs.writeFileString(temp, text, { mode: 0o600 })
    yield* fs.rename(temp, target)
  }).pipe(Effect.ensuring(fs.remove(temp).pipe(Effect.ignore)))
})

// Resolve every link by hand so a dangling link still writes to its intended target instead of being replaced.
const resolveTarget = Effect.fnUntraced(function* (fs: FileSystem.FileSystem, file: string) {
  const seen = new Set<string>()
  let current = file
  while (true) {
    if (seen.has(current)) return yield* Effect.fail(new Error(`Too many symbolic links: ${file}`))
    seen.add(current)
    const link = yield* fs.readLink(current).pipe(Effect.option)
    if (Option.isNone(link)) return current
    current = path.resolve(path.dirname(current), link.value)
  }
})
