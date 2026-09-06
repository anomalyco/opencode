import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer, PlatformError } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { filesystem } from "@opencode-ai/core/effect/app-node-platform"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const accessDenied = PlatformError.systemError({
  _tag: "PermissionDenied",
  module: "FileSystem",
  method: "realPath",
  pathOrDescriptor: "C:\\System Volume Information\\locked",
})

// Real FSUtil service with realPath forced to fail for a non-NotFound reason
// (ACL-denied traversal component on Windows, ELOOP, ...).
const deniedRealPath = Layer.effect(
  FSUtil.Service,
  Effect.gen(function* () {
    const real = yield* FSUtil.Service
    return FSUtil.Service.of({
      ...real,
      realPath: () => Effect.fail(accessDenied),
    })
  }),
).pipe(Layer.provide(LayerNode.compile(LayerNode.group([FSUtil.node, filesystem]))))

const it = testEffect(LayerNode.compile(LayerNode.group([FSUtil.node, filesystem])))
const itDenied = testEffect(deniedRealPath)

describe("FSUtil.resolve", () => {
  itDenied.effect("degrades to the lexical path when realPath fails with a non-NotFound error", () =>
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const target = path.join("C:", "System Volume Information", "locked")
      // Regression lock: this used to die via Effect.orDie, aborting callers
      // such as the bash tool's advisory external-directory scan.
      expect(yield* fs.resolve(target)).toBe(target)
    }),
  )

  it.live("canonicalizes existing paths", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const fs = yield* FSUtil.Service
          const resolved = yield* fs.resolve(path.join(tmp.path, "file.txt"))
          expect(resolved.toLowerCase()).toContain("file.txt")
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )
})
