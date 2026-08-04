import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath, RelativePath } from "@opencode-ai/core/schema"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { it } from "./lib/effect"

const provide = (directory: string) =>
  Effect.provide(
    LayerNode.compile(FileSystem.node, [
      [
        Location.node,
        Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
      ],
    ]),
  )

const withTmp = <A, E, R>(f: (directory: string) => Effect.Effect<A, E, R>) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(Effect.flatMap((tmp) => f(tmp.path)))

describe("FileSystem", () => {
  it.live("reads text and binary files", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "text.txt"), "hello"))
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "data.bin"), Buffer.from([0, 1, 2])))
        const service = yield* FileSystem.Service
        const text = yield* service.read({ path: RelativePath.make("text.txt") })
        const binary = yield* service.read({ path: RelativePath.make("data.bin") })
        expect(new TextDecoder().decode(text.content)).toBe("hello")
        expect(text.mime).toBe("text/plain")
        expect(binary.content).toEqual(new Uint8Array([0, 1, 2]))
      }).pipe(provide(directory)),
    ),
  )

  it.live("lists direct children", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.mkdir(path.join(directory, "src")))
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "README.md"), "# Test"))
        const entries = yield* (yield* FileSystem.Service).list()
        expect(entries.map((entry) => ({ path: entry.path, type: entry.type }))).toEqual([
          { path: RelativePath.make("src" + path.sep), type: "directory" },
          { path: RelativePath.make("README.md"), type: "file" },
        ])
      }).pipe(provide(directory)),
    ),
  )

  it.live("rejects lexical escapes", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const result = yield* (yield* FileSystem.Service)
          .read({ path: RelativePath.make("../outside.txt") })
          .pipe(Effect.exit)
        expect(Exit.isFailure(result)).toBe(true)
      }).pipe(provide(directory)),
    ),
  )

  it.live("finds files created after startup once the index is refreshed", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        // Seed an initial file so the async index scan has a fence to wait on.
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "seed.txt"), "seed"))
        const service = yield* FileSystem.Service
        const waitFor = (name: string, maxAttempts = 50): Effect.Effect<void> =>
          Effect.gen(function* () {
            if (maxAttempts <= 0) throw new Error(`Timed out waiting for ${name}`)
            const found = yield* service.find({ query: name, type: "file" })
            if (found.some((entry) => entry.path.endsWith(name))) return
            yield* Effect.sleep("50 millis")
            yield* waitFor(name, maxAttempts - 1)
          })
        yield* waitFor("seed.txt")

        // A new file added after startup is not in the static snapshot yet.
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "fresh.ts"), "// fresh"))
        const before = yield* service.find({ query: "fresh.ts", type: "file" })
        expect(before.some((entry) => entry.path.endsWith("fresh.ts"))).toBe(false)

        // Refreshing rebuilds the snapshot and makes the new file discoverable.
        yield* service.refresh()
        yield* waitFor("fresh.ts")
        const after = yield* service.find({ query: "fresh.ts", type: "file" })
        expect(after.some((entry) => entry.path.endsWith("fresh.ts"))).toBe(true)
      }).pipe(provide(directory)),
    ),
  )
})
