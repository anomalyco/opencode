import { describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { Protected } from "@opencode-ai/core/filesystem/protected"
import { FileSystemSearch } from "@opencode-ai/core/filesystem/search"
import { Location } from "@opencode-ai/core/location"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { AbsolutePath, RelativePath } from "@opencode-ai/core/schema"
import { location } from "../fixture/location"

describe("FileSystemSearch", () => {
  test("bounds a home scan even when home is detected as a repository", async () => {
    let observed: Ripgrep.FindInput | undefined
    const home = AbsolutePath.make(os.homedir())
    const layer = AppNodeBuilder.build(FileSystemSearch.node, [
      [
        Location.node,
        Layer.succeed(
          Location.Service,
          Location.Service.of(
            location({ directory: home }, { vcs: { type: "git", store: AbsolutePath.make(path.join(home, ".git")) } }),
          ),
        ),
      ],
      [
        Ripgrep.node,
        Layer.succeed(
          Ripgrep.Service,
          Ripgrep.Service.of({
            find: (input) =>
              Effect.gen(function* () {
                observed = input
                if (input.onEntry)
                  yield* input.onEntry(FileSystem.Entry.make({ path: RelativePath.make("src/index.ts"), type: "file" }))
                return []
              }),
            glob: () => Effect.succeed([]),
            grep: () => Effect.succeed([]),
          }),
        ),
      ],
    ])

    await Effect.runPromise(
      Effect.gen(function* () {
        const search = yield* FileSystemSearch.Service
        yield* Effect.sleep("10 millis")
        expect(observed?.limit).toBe(100_000)
        expect(observed?.exclude).toEqual([...Protected.names()].map((name) => `${name}/**`))
        expect((yield* search.find({ query: "src", type: "directory" }))[0]?.path).toBe(
          RelativePath.make(`src${path.sep}`),
        )
      }).pipe(Effect.provide(layer), Effect.scoped),
    )
  })
})
