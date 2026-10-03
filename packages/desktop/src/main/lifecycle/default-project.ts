import { Effect, FileSystem } from "effect"

export const makeDefaultProject = Effect.fn("Onboarding.makeDefaultProject")(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem
  const denied = yield* fs.makeDirectory(directory, { recursive: true }).pipe(
    Effect.as(false),
    Effect.catchTag("PlatformError", (error) => {
      // macOS privacy denials are reported as Unknown with an EPERM cause.
      if (
        error.reason._tag === "PermissionDenied" ||
        (error.reason._tag === "Unknown" &&
          error.reason.cause instanceof Error &&
          "code" in error.reason.cause &&
          error.reason.cause.code === "EPERM")
      )
        return Effect.succeed(true)
      return Effect.fail(error)
    }),
  )
  return denied ? { permissionDenied: directory } : directory
})
