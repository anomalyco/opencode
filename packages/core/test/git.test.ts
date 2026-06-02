import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { Git } from "@opencode-ai/core/git"
import { branch, commit, gitRemote } from "./fixture/git"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(Git.defaultLayer)

describe("Git", () => {
  it.live("clones a remote and reads checkout metadata", () =>
    withRemote((fixture) =>
      Effect.gen(function* () {
        const git = yield* Git.Service
        const target = path.join(fixture.root, "checkout")
        const result = yield* git.clone({ remote: fixture.remote, target })

        expect(result.exitCode).toBe(0)
        expect(yield* git.origin(target)).toBe(fixture.remote)
        expect(yield* git.head(target)).toBeString()
        expect(yield* git.branch(target)).toBe("main")
        expect(yield* git.remoteHead(target)).toBe("origin/main")
        expect(yield* read(path.join(target, "README.md"))).toBe("one\n")
      }),
    ),
  )

  it.live("fetches, checks out, and resets remote changes", () =>
    withRemote((fixture) =>
      Effect.gen(function* () {
        const git = yield* Git.Service
        const target = path.join(fixture.root, "checkout")
        yield* git.clone({ remote: fixture.remote, target })

        yield* Effect.promise(() => commit(fixture.source, "two\n", "second"))
        expect((yield* git.fetch(target)).exitCode).toBe(0)
        expect((yield* git.reset(target, "origin/main")).exitCode).toBe(0)
        expect(yield* read(path.join(target, "README.md"))).toBe("two\n")

        yield* Effect.promise(() => branch(fixture.source, "feature/docs", "feature\n"))
        expect((yield* git.fetchBranch(target, "feature/docs")).exitCode).toBe(0)
        expect((yield* git.checkout(target, "feature/docs")).exitCode).toBe(0)
        expect((yield* git.reset(target, "origin/feature/docs")).exitCode).toBe(0)
        expect(yield* git.branch(target)).toBe("feature/docs")
        expect(yield* read(path.join(target, "README.md"))).toBe("feature\n")
      }),
    ),
  )
})

function withRemote<A, E, R>(body: (fixture: Awaited<ReturnType<typeof gitRemote>>) => Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.promise(async () => {
      const root = await tmpdir()
      return { root, fixture: await gitRemote(root.path) }
    }),
    (input) => body(input.fixture),
    (input) => Effect.promise(() => input.root[Symbol.asyncDispose]()),
  )
}

function read(file: string) {
  return Effect.promise(() => fs.readFile(file, "utf8")).pipe(Effect.map((content) => content.replace(/\r\n/g, "\n")))
}
