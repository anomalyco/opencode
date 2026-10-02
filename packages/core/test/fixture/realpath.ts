import { Effect, FileSystem, Layer, type PlatformError } from "effect"
import { LayerNodePlatform } from "@opencode/util/effect/app-node-platform"

/** Fails platform realPath for selected paths, so FSUtil's own error classification still runs. */
export function blockRealPath(
  fs: FileSystem.FileSystem,
  failure: (target: string) => PlatformError.PlatformError | undefined,
) {
  return LayerNodePlatform.filesystem.replace(
    Layer.succeed(FileSystem.FileSystem, {
      ...fs,
      realPath: (target) => {
        const error = failure(target)
        return error ? Effect.fail(error) : fs.realPath(target)
      },
    }),
  )
}
