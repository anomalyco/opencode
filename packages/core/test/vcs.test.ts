import { $ } from "bun"
import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Fiber, Layer, Stream } from "effect"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Bus } from "@opencode-ai/core/bus"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Vcs } from "@opencode-ai/core/vcs"
import { FileSystem } from "@opencode-ai/schema/filesystem"
import { VcsEvent } from "@opencode-ai/schema/vcs-event"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { it } from "./lib/effect"

const provide = (directory: string, input: { git?: boolean } = {}) =>
  Effect.provide(
    LayerNode.compile(LayerNode.group([Vcs.node, Bus.node]), [
      [
        Location.node,
        Layer.succeed(
          Location.Service,
          Location.Service.of(
            location(
              { directory: AbsolutePath.make(directory) },
              input.git ? { vcs: { type: "git", store: AbsolutePath.make(path.join(directory, ".git")) } } : {},
            ),
          ),
        ),
      ],
    ]),
  )

const withTmp = <A, E, R>(f: (directory: string) => Effect.Effect<A, E, R>) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(Effect.flatMap((tmp) => f(tmp.path)))

const withGit = <A, E, R>(f: (directory: string) => Effect.Effect<A, E, R>) =>
  withTmp((directory) =>
    Effect.promise(() => initRepo(directory)).pipe(
      Effect.andThen(f(directory).pipe(provide(directory, { git: true }))),
    ),
  )

async function initRepo(directory: string) {
  await $`git init -b main`.cwd(directory).quiet()
  await $`git config core.fsmonitor false`.cwd(directory).quiet()
  await $`git config commit.gpgsign false`.cwd(directory).quiet()
  await $`git config user.email test@opencode.test`.cwd(directory).quiet()
  await $`git config user.name Test`.cwd(directory).quiet()
}

async function commitAll(directory: string, message: string) {
  await $`git add -A`.cwd(directory).quiet()
  await $`git commit -m ${message}`.cwd(directory).quiet()
}

describe("Vcs", () => {
  it.live("returns empty results outside version control", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const vcs = yield* Vcs.Service
        expect(yield* vcs.info()).toEqual({ branch: {} })
        expect(yield* vcs.status()).toEqual([])
        expect(yield* vcs.diff("working")).toEqual([])
        expect(yield* vcs.diff("branch")).toEqual([])
      }).pipe(provide(directory)),
    ),
  )

  it.live("reports modified, deleted, and untracked files", () =>
    withGit((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await fs.writeFile(path.join(directory, "keep.txt"), "one\ntwo\n")
          await fs.writeFile(path.join(directory, "gone.txt"), "bye\n")
          await commitAll(directory, "initial")
          await fs.writeFile(path.join(directory, "keep.txt"), "one\nthree\n")
          await fs.rm(path.join(directory, "gone.txt"))
          await fs.writeFile(path.join(directory, "new.txt"), "hello\nworld\n")
        })
        const vcs = yield* Vcs.Service
        const status = yield* vcs.status()
        expect(status).toEqual([
          { file: "gone.txt", additions: 0, deletions: 1, status: "deleted" },
          { file: "keep.txt", additions: 1, deletions: 1, status: "modified" },
          { file: "new.txt", additions: 2, deletions: 0, status: "added" },
        ])
      }),
    ),
  )

  it.live("caches branch info and publishes HEAD changes", () =>
    withGit((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await fs.writeFile(path.join(directory, "file.txt"), "one\n")
          await commitAll(directory, "initial")
        })
        const vcs = yield* Vcs.Service
        const bus = yield* Bus.Service
        expect(yield* vcs.info()).toEqual({ branch: { current: "main", default: undefined } })

        const updated = yield* bus
          .subscribe(VcsEvent.BranchUpdated)
          .pipe(Stream.take(1), Stream.runHead, Effect.forkScoped({ startImmediately: true }))
        yield* Effect.promise(() => $`git checkout -q -b feature`.cwd(directory).quiet())

        yield* bus.publish(FileSystem.Event.Changed, { file: path.join(directory, "HEAD"), event: "change" })
        expect(yield* vcs.info()).toEqual({ branch: { current: "main", default: undefined } })

        yield* bus.publish(FileSystem.Event.Changed, { file: path.join(directory, ".git", "HEAD"), event: "change" })
        expect(yield* Fiber.join(updated)).toMatchObject({
          _tag: "Some",
          value: { location: { directory }, data: { branch: "feature" } },
        })
        expect(yield* vcs.info()).toEqual({ branch: { current: "feature", default: "main" } })
      }),
    ),
  )

  it.live("diffs the working copy against HEAD with patches", () =>
    withGit((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await fs.writeFile(path.join(directory, "keep.txt"), "one\ntwo\n")
          await commitAll(directory, "initial")
          await fs.writeFile(path.join(directory, "keep.txt"), "one\nthree\n")
          await fs.writeFile(path.join(directory, "spaced name.txt"), "hello\n")
        })
        const vcs = yield* Vcs.Service
        const diff = yield* vcs.diff("working")
        expect(diff.map((item) => ({ file: item.file, status: item.status }))).toEqual([
          { file: "keep.txt", status: "modified" },
          { file: "spaced name.txt", status: "added" },
        ])
        expect(diff[0].patch).toContain("-two")
        expect(diff[0].patch).toContain("+three")
        expect(diff[0].additions).toBe(1)
        expect(diff[0].deletions).toBe(1)
        expect(diff[1].patch).toContain("+hello")
        expect(diff[1].additions).toBe(1)
      }),
    ),
  )

  it.live("respects the context option", () =>
    withGit((directory) =>
      Effect.gen(function* () {
        const body = Array.from({ length: 20 }, (_, index) => `line-${index}`).join("\n") + "\n"
        yield* Effect.promise(async () => {
          await fs.writeFile(path.join(directory, "file.txt"), body)
          await commitAll(directory, "initial")
          await fs.writeFile(path.join(directory, "file.txt"), body.replace("line-10", "changed"))
        })
        const vcs = yield* Vcs.Service
        const full = yield* vcs.diff("working")
        expect(full[0].patch).toContain("line-0")
        expect(full[0].patch).toContain("line-19")
        const tight = yield* vcs.diff("working", { context: 1 })
        expect(tight[0].patch).toContain("line-9")
        expect(tight[0].patch).not.toContain("line-0")
      }),
    ),
  )

  it.live("diffs before the first commit", () =>
    withGit((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await fs.writeFile(path.join(directory, "new.txt"), "hello\n")
        })
        const vcs = yield* Vcs.Service
        expect(yield* vcs.status()).toEqual([{ file: "new.txt", additions: 1, deletions: 0, status: "added" }])
        const diff = yield* vcs.diff("working")
        expect(diff).toHaveLength(1)
        expect(diff[0].patch).toContain("+hello")
      }),
    ),
  )

  it.live("diffs a feature branch against the default branch", () =>
    withGit((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await fs.writeFile(path.join(directory, "file.txt"), "one\n")
          await commitAll(directory, "initial")
        })
        const vcs = yield* Vcs.Service
        expect(yield* vcs.diff("branch")).toEqual([])

        yield* Effect.promise(async () => {
          await $`git checkout -q -b feature`.cwd(directory).quiet()
          await fs.writeFile(path.join(directory, "file.txt"), "one\ntwo\n")
          await commitAll(directory, "feature change")
        })
        const diff = yield* vcs.diff("branch")
        expect(diff.map((item) => ({ file: item.file, status: item.status }))).toEqual([
          { file: "file.txt", status: "modified" },
        ])
        expect(diff[0].patch).toContain("+two")
      }),
    ),
  )
})
