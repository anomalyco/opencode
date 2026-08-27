import { $ } from "bun"
import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { AppProcess } from "@opencode-ai/util/process"
import { Bus } from "@opencode-ai/core/bus"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Vcs } from "@opencode-ai/core/vcs"
import { VcsGitPlugin } from "@opencode-ai/core/plugin/vcs/git"
import { VcsJjPlugin } from "@opencode-ai/core/plugin/vcs/jj"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { it } from "./lib/effect"
import { host } from "./plugin/host"

const describeJj = Bun.which("jj") ? describe : describe.skip

const provide = (directory: string, input: { worktree: string; colocated?: boolean }) =>
  Effect.provide(
    LayerNode.compile(LayerNode.group([Vcs.node, Bus.node, Location.node, AppProcess.node, FSUtil.node]), [
      [
        Location.node,
        Layer.succeed(
          Location.Service,
          Location.Service.of({
            ...location(
              { directory: AbsolutePath.make(directory) },
              {
                projectDirectory: AbsolutePath.make(input.worktree),
                vcs: input.colocated
                  ? { type: "git", store: AbsolutePath.make(path.join(input.worktree, ".git")) }
                  : { type: "jj", store: AbsolutePath.make(path.join(input.worktree, ".jj", "repo")) },
              },
            ),
            ...(input.colocated ? { vcsBackend: "jj" } : {}),
          }),
        ),
      ],
    ]),
  )

const withJj = <A, E, R>(
  f: (directory: string) => Effect.Effect<A, E, R>,
  options: { colocated?: boolean; nested?: string } = {},
) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(
    Effect.flatMap((tmp) =>
      Effect.promise(async () => {
        await jj(tmp.path, "git", "init", ...(options.colocated ? [] : ["--no-colocate"]))
        if (options.nested) await fs.mkdir(path.join(tmp.path, options.nested), { recursive: true })
      }).pipe(
        Effect.andThen(
          Effect.gen(function* () {
            const vcs = yield* Vcs.Service
            const context = host()
            const scoped = { ...context, vcs: { ...context.vcs, transform: vcs.transform, reload: vcs.reload } }
            if (options.colocated) yield* VcsGitPlugin.Plugin.effect(scoped)
            yield* VcsJjPlugin.Plugin.effect(scoped)
            return yield* f(tmp.path)
          }).pipe(
            provide(path.join(tmp.path, options.nested ?? ""), {
              worktree: tmp.path,
              colocated: options.colocated,
            }),
          ),
        ),
      ),
    ),
  )

async function jj(directory: string, ...args: string[]) {
  await $`jj --quiet ${args}`.cwd(directory).quiet()
}

describeJj("Vcs jujutsu", () => {
  it.live("reports modified, deleted, and added files", () =>
    withJj((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await fs.writeFile(path.join(directory, "keep.txt"), "one\ntwo\n")
          await fs.writeFile(path.join(directory, "gone.txt"), "bye\n")
          await jj(directory, "commit", "-m", "initial")
          await fs.writeFile(path.join(directory, "keep.txt"), "one\nthree\n")
          await fs.rm(path.join(directory, "gone.txt"))
          await fs.writeFile(path.join(directory, "new file.txt"), "hello\nworld\n")
        })
        const vcs = yield* Vcs.Service
        expect(yield* vcs.status()).toEqual([
          { file: "gone.txt", additions: 0, deletions: 1, status: "deleted" },
          { file: "keep.txt", additions: 1, deletions: 1, status: "modified" },
          { file: "new file.txt", additions: 2, deletions: 0, status: "added" },
        ])
        const diff = yield* vcs.diff("working")
        expect(diff.map((item) => ({ file: item.file, status: item.status }))).toEqual([
          { file: "gone.txt", status: "deleted" },
          { file: "keep.txt", status: "modified" },
          { file: "new file.txt", status: "added" },
        ])
        expect(diff[0].patch).toContain("-bye")
        expect(diff[1].patch).toContain("+three")
        expect(diff[2].patch).toContain("+hello")
      }),
    ),
  )

  it.live("preserves patches and counts for filenames with tabs and newlines", () =>
    withJj((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await fs.writeFile(path.join(directory, "line\nname.txt"), "first\nsecond\n")
          await fs.writeFile(path.join(directory, "tab\tname.txt"), "third\n")
        })
        const vcs = yield* Vcs.Service
        expect(yield* vcs.status()).toEqual([
          { file: "line\nname.txt", additions: 2, deletions: 0, status: "added" },
          { file: "tab\tname.txt", additions: 1, deletions: 0, status: "added" },
        ])
        const diff = yield* vcs.diff("working")
        expect(diff[0].patch).toContain("+first")
        expect(diff[1].patch).toContain("+third")
      }),
    ),
  )

  it.live("preserves rename destinations and their patches", () =>
    withJj((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await fs.writeFile(path.join(directory, "before.txt"), "one\ntwo\n")
          await jj(directory, "commit", "-m", "initial")
          await fs.rename(path.join(directory, "before.txt"), path.join(directory, "after.txt"))
        })
        const vcs = yield* Vcs.Service
        const diff = yield* vcs.diff("working")
        expect(diff).toMatchObject([{ file: "after.txt", status: "modified", additions: 0, deletions: 0 }])
        expect(diff[0].patch).toContain("rename to after.txt")
      }),
    ),
  )

  it.live("prefers Jujutsu over Git in colocated repositories", () =>
    withJj(
      (directory) =>
        Effect.gen(function* () {
          yield* Effect.promise(async () => {
            await fs.writeFile(path.join(directory, "file.txt"), "initial\n")
            await jj(directory, "commit", "-m", "initial")
            await jj(directory, "bookmark", "create", "feature", "-r", "@")
          })
          const vcs = yield* Vcs.Service
          yield* vcs.reload()
          expect(yield* vcs.info()).toEqual({ branch: { current: "feature", default: undefined } })
          expect(yield* vcs.branches()).toEqual(["feature"])
        }),
      { colocated: true },
    ),
  )

  it.live("lists and filters bookmarks without inventing an active bookmark", () =>
    withJj((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await fs.writeFile(path.join(directory, "file.txt"), "initial\n")
          await jj(directory, "commit", "-m", "initial")
          await jj(directory, "bookmark", "create", "main", "-r", "@-")
          await jj(directory, "bookmark", "create", "feature-one", "feature-two", "-r", "@-")
        })
        const vcs = yield* Vcs.Service
        yield* vcs.reload()
        expect(yield* vcs.info()).toEqual({ branch: { current: undefined, default: "main" } })
        expect(yield* vcs.branches()).toEqual(["feature-one", "feature-two", "main"])
        expect(yield* vcs.branches({ search: "FEATURE", limit: 1 })).toEqual(["feature-one"])
        expect(yield* vcs.branches({ search: "*" })).toEqual([])
      }),
    ),
  )

  it.live("uses the configured trunk bookmark instead of an unrelated main bookmark", () =>
    withJj((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await fs.writeFile(path.join(directory, "file.txt"), "initial\n")
          await jj(directory, "commit", "-m", "initial")
          await jj(directory, "bookmark", "create", "main", "-r", "@-")
          await fs.writeFile(path.join(directory, "file.txt"), "initial\nnext\n")
          await jj(directory, "commit", "-m", "develop")
          await jj(directory, "bookmark", "create", "develop", "-r", "@-")
          await jj(directory, "config", "set", "--repo", 'revset-aliases."trunk()"', "develop")
        })
        const vcs = yield* Vcs.Service
        yield* vcs.reload()
        expect((yield* vcs.info()).branch.default).toBe("develop")
      }),
    ),
  )

  it.live("scopes status and diffs to nested directories", () =>
    withJj(
      (directory) =>
        Effect.gen(function* () {
          yield* Effect.promise(async () => {
            await fs.writeFile(path.join(directory, "outside.txt"), "outside\n")
            await fs.writeFile(path.join(directory, "nested", "inside.txt"), "inside\n")
          })
          const vcs = yield* Vcs.Service
          expect(yield* vcs.status()).toEqual([
            { file: "nested/inside.txt", additions: 1, deletions: 0, status: "added" },
          ])
          expect((yield* vcs.diff("working")).map((item) => item.file)).toEqual(["nested/inside.txt"])
        }),
      { nested: "nested" },
    ),
  )

  it.live("respects the diff context option", () =>
    withJj((directory) =>
      Effect.gen(function* () {
        const body = Array.from({ length: 20 }, (_, index) => `line-${index}`).join("\n") + "\n"
        yield* Effect.promise(async () => {
          await fs.writeFile(path.join(directory, "file.txt"), body)
          await jj(directory, "commit", "-m", "initial")
          await fs.writeFile(path.join(directory, "file.txt"), body.replace("line-10", "changed"))
        })
        const vcs = yield* Vcs.Service
        expect((yield* vcs.diff("working"))[0].patch).toContain("line-0")
        const tight = yield* vcs.diff("working", { context: 1 })
        expect(tight[0].patch).toContain("line-9")
        expect(tight[0].patch).not.toContain("line-0")
      }),
    ),
  )

  it.live("compares a change against the main bookmark fork point", () =>
    withJj((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await fs.writeFile(path.join(directory, "file.txt"), "one\n")
          await jj(directory, "commit", "-m", "initial")
          await jj(directory, "bookmark", "create", "main", "-r", "@-")
        })
        const vcs = yield* Vcs.Service
        expect(yield* vcs.diff("branch")).toEqual([])
        yield* Effect.promise(() => fs.writeFile(path.join(directory, "file.txt"), "one\ntwo\n"))
        const diff = yield* vcs.diff("branch")
        expect(diff.map((item) => ({ file: item.file, status: item.status }))).toEqual([
          { file: "file.txt", status: "modified" },
        ])
        expect(diff[0].patch).toContain("+two")
      }),
    ),
  )
})
