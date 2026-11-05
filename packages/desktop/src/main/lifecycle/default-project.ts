export * as DefaultProject from "./default-project"

import { Effect, FileSystem, Option, Schema } from "effect"
import { DEFAULT_PROJECT_DIRECTORY_KEY } from "../storage/keys"
import type { SettingsStore } from "../storage/store"

export const create = Effect.fn("DefaultProject.create")(function* (store: SettingsStore, directory: string) {
  const fs = yield* FileSystem.FileSystem
  yield* fs.makeDirectory(directory, { recursive: true })
  store.set(DEFAULT_PROJECT_DIRECTORY_KEY, directory)

  return directory
})

export const restore = Effect.fn("DefaultProject.restore")(function* (store: SettingsStore) {
  const directory = Schema.decodeUnknownOption(Schema.NonEmptyString)(store.get(DEFAULT_PROJECT_DIRECTORY_KEY))

  if (Option.isNone(directory)) return

  const fs = yield* FileSystem.FileSystem
  yield* fs.makeDirectory(directory.value, { recursive: true })
})
