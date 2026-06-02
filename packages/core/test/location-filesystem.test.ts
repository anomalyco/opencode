import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { describe, expect } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Location } from "@opencode-ai/core/location"
import { LocationFileSystem } from "@opencode-ai/core/location-filesystem"
import { AbsolutePath, RelativePath } from "@opencode-ai/core/schema"
import { tmpdir } from "./fixture/tmpdir"
import { location } from "./fixture/location"
import { it } from "./lib/effect"

function provide(directory: string) {
  return Effect.provide(
    LocationFileSystem.locationLayer.pipe(
      Layer.provide(
        Layer.mergeAll(
          AppFileSystem.defaultLayer,
          Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
        ),
      ),
    ),
  )
}

function withTmp<A, E, R>(f: (directory: string) => Effect.Effect<A, E, R>) {
  return Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(Effect.flatMap((tmp) => f(tmp.path).pipe(provide(tmp.path))))
}

describe("LocationFileSystem", () => {
  it.live("reads text and binary files", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "hello.txt"), "hello"))
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "data.bin"), Buffer.from([0, 1, 2])))
        const service = yield* LocationFileSystem.Service

        expect(yield* service.read({ path: RelativePath.make("hello.txt") })).toEqual({
          type: "text",
          content: "hello",
          mime: "text/plain",
        })
        expect(yield* service.read({ path: RelativePath.make("data.bin") })).toEqual({
          type: "binary",
          content: "AAEC",
          encoding: "base64",
          mime: "application/octet-stream",
        })
      }),
    ),
  )

  it.live("lists direct children with relative paths and resolved URIs", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.mkdir(path.join(directory, "src")))
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "README.md"), "# Test"))
        const service = yield* LocationFileSystem.Service

        expect(yield* service.list()).toEqual([
          {
            path: RelativePath.make("src"),
            uri: pathToFileURL(path.join(directory, "src")).href,
            type: "directory",
            mime: "application/x-directory",
          },
          {
            path: RelativePath.make("README.md"),
            uri: pathToFileURL(path.join(directory, "README.md")).href,
            type: "file",
            mime: "text/markdown",
          },
        ])
      }),
    ),
  )

  it.live("rejects paths outside the location", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const service = yield* LocationFileSystem.Service
        expect(
          Exit.isFailure(yield* service.read({ path: RelativePath.make("../outside.txt") }).pipe(Effect.exit)),
        ).toBe(true)
      }),
    ),
  )
})
