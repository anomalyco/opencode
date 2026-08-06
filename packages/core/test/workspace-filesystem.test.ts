import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { Location } from "@opencode-ai/core/location"
import { RelativePath } from "@opencode-ai/core/schema"
import { WorkspaceEnvironment } from "@opencode-ai/core/workspace/environment"
import { testEffect } from "./lib/effect"
import { hostedLocationLayer, memoryEnvironment } from "./lib/workspace"

const memory = memoryEnvironment({
  "/workspace/README.md": "# hello\n",
  "/workspace/src/index.ts": "export {}\n",
  "/workspace/src/util/deep.ts": "export const deep = 1\n",
})

const it = testEffect(
  AppNodeBuilder.build(FileSystem.hostedNode, [
    [WorkspaceEnvironment.node, Layer.succeed(WorkspaceEnvironment.Service, memory.environment)],
    [Location.node, hostedLocationLayer()],
  ]),
)

describe("hosted FileSystem", () => {
  it.effect("reads a file through the environment", () =>
    Effect.gen(function* () {
      const filesystem = yield* FileSystem.Service
      const result = yield* filesystem.read({ path: RelativePath.make("README.md") })
      expect(new TextDecoder().decode(result.content)).toBe("# hello\n")
      expect(result.mime).toBe("text/markdown")
    }),
  )

  it.effect("lists directories before files with posix separators", () =>
    Effect.gen(function* () {
      const filesystem = yield* FileSystem.Service
      const entries = yield* filesystem.list({ path: RelativePath.make("src") })
      expect(entries.map((entry) => String(entry.path))).toEqual(["src/util/", "src/index.ts"])
    }),
  )

  it.effect("lists the root when no path is given", () =>
    Effect.gen(function* () {
      const filesystem = yield* FileSystem.Service
      const entries = yield* filesystem.list()
      expect(entries.map((entry) => String(entry.path))).toEqual(["src/", "README.md"])
    }),
  )

  it.effect("refuses paths that escape the workspace", () =>
    Effect.gen(function* () {
      const filesystem = yield* FileSystem.Service
      const exit = yield* filesystem.read({ path: RelativePath.make("../etc/passwd") }).pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
    }),
  )
})
