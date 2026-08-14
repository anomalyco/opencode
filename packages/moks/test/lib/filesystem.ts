import path from "path"
import { Effect, FileSystem } from "effect"

export const writeFileStringScoped = Effect.fn("test.writeFileStringScoped")(function* (file: string, text: string) {
  const fs = yield* FileSystem.FileSystem
  yield* fs.makeDirectory(path.dirname(file), { recursive: true })
  yield* fs.writeFileString(file, text)
  yield* Effect.addFinalizer(() => fs.remove(file, { force: true }).pipe(Effect.orDie))
  return file
})
