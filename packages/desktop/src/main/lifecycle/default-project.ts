import { Effect, FileSystem } from "effect"
import type { PlatformError } from "effect/PlatformError"

export const makeDefaultProject = Effect.fn("Onboarding.makeDefaultProject")(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem
  const denied = yield* fs.makeDirectory(directory, { recursive: true }).pipe(
    Effect.as(false),
    Effect.catchTag("PlatformError", (error) => {
      if (isPermissionDenied(error)) return Effect.succeed(true)
      return Effect.fail(error)
    }),
  )
  return denied ? { permissionDenied: directory } : directory
})

function isPermissionDenied(error: PlatformError) {
  if (error.reason._tag === "PermissionDenied") return true
  const cause = error.cause
  return typeof cause === "object" && cause !== null && "code" in cause && (cause.code === "EPERM" || cause.code === "EACCES")
}
