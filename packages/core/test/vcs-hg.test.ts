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
import { VcsEvent } from "@opencode-ai/schema/vcs-event"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { it } from "./lib/effect"

const describeHg = Bun.which("hg") ? describe : describe.skip

const provide = (directory: string) =>
  Effect.provide(
    LayerNode.compile(LayerNode.group([Vcs.node, Bus.node]), [
      [
        Location.node,
        Layer.succeed(
          Location.Service,
          Location.Service.of(
            location(
              { directory: AbsolutePath.make(directory) },
              { vcs: { type: "hg", store: AbsolutePath.make(path.join(directory, ".hg")) } },
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

const withHg = <A, E, R>(f: (directory: string) => Effect.Effect<A, E, R>) =>
  withTmp((directory) =>
    Effect.promise(() => hg(directory, "init")).pipe(
      Effect.andThen(f(directory).pipe(provide(directory))),
    ),
  )

async function hg(directory: string, ...args: string[]) {
  await $`hg ${args}`
    .cwd(directory)
    .env({ ...process.env, HGPLAIN: "1" })
    .quiet()
}

async function commitAll(directory: string, message: string) {
  await hg(directory, "addremove", "-q")
  await hg(directory, "commit", "-q", "-m", message, "-u", "test")
}

describeHg("Vcs mercurial", () => {
  it.live("reports modified, missing, and untracked files", () =>
    withHg((directory) =>
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

  it.live("diffs the working copy with synthesized untracked and missing patches", () =>
    withHg((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await fs.writeFile(path.join(directory, "keep.txt"), "one\ntwo\n")
          await fs.writeFile(path.join(directory, "gone.txt"), "bye\n")
          await commitAll(directory, "initial")
          await fs.writeFile(path.join(directory, "keep.txt"), "one\nthree\n")
          await fs.rm(path.join(directory, "gone.txt"))
          await fs.writeFile(path.join(directory, "spaced name.txt"), "hello\n")
        })
        const vcs = yield* Vcs.Service
        const diff = yield* vcs.diff("working")
        expect(diff.map((item) => ({ file: item.file, status: item.status }))).toEqual([
          { file: "gone.txt", status: "deleted" },
          { file: "keep.txt", status: "modified" },
          { file: "spaced name.txt", status: "added" },
        ])
        expect(diff[0].patch).toContain("-bye")
        expect(diff[1].patch).toContain("-two")
        expect(diff[1].patch).toContain("+three")
        expect(diff[1].additions).toBe(1)
        expect(diff[1].deletions).toBe(1)
        expect(diff[2].patch).toContain("+hello")
        expect(diff[2].additions).toBe(1)
      }),
    ),
  )

  it.live("caches branch info and publishes branch metadata changes", () =>
    withHg((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await fs.writeFile(path.join(directory, "file.txt"), "one\n")
          await commitAll(directory, "initial")
        })
        const vcs = yield* Vcs.Service
        const bus = yield* Bus.Service
        expect(yield* vcs.info()).toEqual({ branch: { current: "default", default: "default" } })

        const updated = yield* bus
          .subscribe(VcsEvent.BranchUpdated)
          .pipe(Stream.take(1), Stream.runHead, Effect.forkScoped({ startImmediately: true }))
        yield* Effect.promise(() => hg(directory, "branch", "-q", "feature"))
        expect(yield* Fiber.join(updated).pipe(Effect.timeout("5 seconds"))).toMatchObject({
          _tag: "Some",
          value: { location: { directory }, data: { branch: "feature" } },
        })
        expect(yield* vcs.info()).toEqual({ branch: { current: "feature", default: "default" } })
      }),
    ),
  )

  it.live("respects the context option", () =>
    withHg((directory) =>
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
    withHg((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await fs.writeFile(path.join(directory, "tracked.txt"), "a\nb\n")
          await hg(directory, "add", "-q", "tracked.txt")
          await fs.writeFile(path.join(directory, "loose.txt"), "hello\n")
        })
        const vcs = yield* Vcs.Service
        expect(yield* vcs.status()).toEqual([
          { file: "loose.txt", additions: 1, deletions: 0, status: "added" },
          { file: "tracked.txt", additions: 2, deletions: 0, status: "added" },
        ])
        const diff = yield* vcs.diff("working")
        expect(diff).toHaveLength(2)
        expect(diff[0].patch).toContain("+hello")
        expect(diff[1].patch).toContain("+a")
      }),
    ),
  )

  it.live("diffs a named branch against the default branch", () =>
    withHg((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await fs.writeFile(path.join(directory, "file.txt"), "one\n")
          await commitAll(directory, "initial")
        })
        const vcs = yield* Vcs.Service
        expect(yield* vcs.diff("branch")).toEqual([])

        yield* Effect.promise(async () => {
          await hg(directory, "branch", "-q", "feature")
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
