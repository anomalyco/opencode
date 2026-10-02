export * as FileSystemDirectory from "./directory.js"

import { Effect, Schema } from "effect"
import { FSUtil } from "@opencode/util/fs-util"
import { AbsolutePath } from "../schema.js"

export class DirectoryNotFoundError extends Schema.TaggedError<DirectoryNotFoundError>()(
  "FileSystem.DirectoryNotFoundError",
  { directory: AbsolutePath, cause: Schema.Defect() },
) {
  override get message() {
    return `Directory not found: ${this.directory}`
  }
}

export class DirectoryAccessDeniedError extends Schema.TaggedError<DirectoryAccessDeniedError>()(
  "FileSystem.DirectoryAccessDeniedError",
  { directory: AbsolutePath, cause: Schema.Defect() },
) {
  override get message() {
    return `Access denied to directory: ${this.directory}`
  }
}

export type Error = DirectoryNotFoundError | DirectoryAccessDeniedError

export const resolve = Effect.fn("FileSystemDirectory.resolve")(function* (directory: AbsolutePath) {
  const fs = yield* FSUtil.Service
  return yield* fs.realPath(directory).pipe(
    Effect.catch((cause): Effect.Effect<never, Error> => {
      if (cause.reason._tag === "NotFound") return Effect.fail(new DirectoryNotFoundError({ directory, cause }))
      // macOS privacy denials arrive as Unknown with an EPERM cause.
      if (
        cause.reason._tag === "PermissionDenied" ||
        (cause.reason._tag === "Unknown" &&
          cause.reason.cause instanceof Error &&
          "code" in cause.reason.cause &&
          cause.reason.cause.code === "EPERM")
      )
        return Effect.fail(new DirectoryAccessDeniedError({ directory, cause }))
      return Effect.die(cause)
    }),
  )
})
