import { describe, expect } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { Effect, Exit } from "effect"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Git } from "@opencode/core/git"
import { AbsolutePath, RelativePath } from "@opencode/core/schema"
import { VcsPatch } from "@opencode/core/vcs/patch"
import { branch, commit, initRepo, read, withRemote } from "./fixture/git"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.compile(Git.node))

describe("Git", () => {
  it.live("discovers repository metadata without a work tree", () =>
    Effect.gen(function* () {
      const root = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(async () => {
        await initRepo(root.path)
        await $`git config core.bare true`.cwd(root.path).quiet()
      })
      const directory = AbsolutePath.make(yield* Effect.promise(() => fs.realpath(root.path)))
      const git = yield* Git.Service
      const repository = yield* git.repo.discover(directory)

      expect(repository?.worktree).toBe(directory)
      expect(repository?.gitDirectory).toBe(AbsolutePath.make(path.join(directory, ".git")))
      expect(repository?.commonDirectory).toBe(repository?.gitDirectory)
    }),
  )

  it.live("clones a remote and reads checkout metadata", () =>
    withRemote((fixture) =>
      Effect.gen(function* () {
        const git = yield* Git.Service
        const target = AbsolutePath.make(path.join(fixture.root, "checkout"))
        const repository = yield* git.repo.clone({ remote: fixture.remote, directory: target })

        expect(yield* git.remote.get(repository)).toBe(fixture.remote)
        expect(yield* git.history.head(repository)).toBeString()
        expect(yield* git.history.branch(repository)).toBe("main")
        expect(yield* git.history.defaultRemoteBranch(repository)).toBe("main")
        expect(repository.worktree).toBe(target)
        expect(repository.gitDirectory).toBe(AbsolutePath.make(path.join(target, ".git")))
        expect(repository.commonDirectory).toBe(repository.gitDirectory)
        expect(yield* read(path.join(target, "README.md"))).toBe("one\n")
      }),
    ),
  )

  it.live("fetches, checks out, and resets remote changes", () =>
    withRemote((fixture) =>
      Effect.gen(function* () {
        const git = yield* Git.Service
        const target = AbsolutePath.make(path.join(fixture.root, "checkout"))
        const repository = yield* git.repo.clone({ remote: fixture.remote, directory: target })

        yield* Effect.promise(() => commit(fixture.source, "two\n", "second"))
        yield* git.sync.fetchRemotes(repository)
        yield* git.sync.resetHard(repository, "origin/main")
        expect(yield* read(path.join(target, "README.md"))).toBe("two\n")

        yield* Effect.promise(() => branch(fixture.source, "feature/docs", "feature\n"))
        yield* git.sync.fetchBranch(repository, { branch: "feature/docs" })
        yield* git.sync.checkoutRemoteBranch(repository, { branch: "feature/docs" })
        yield* git.sync.resetHard(repository, "origin/feature/docs")
        expect(yield* git.history.branch(repository)).toBe("feature/docs")
        expect(yield* read(path.join(target, "README.md"))).toBe("feature\n")
      }),
    ),
  )
})

describe("Git worktrees", () => {
  it.live("creates, lists, and removes linked worktrees", () =>
    Effect.gen(function* () {
      const root = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => initRepo(root.path))
      const directory = AbsolutePath.make(yield* Effect.promise(() => fs.realpath(root.path)))
      const worktree = AbsolutePath.make(`${root.path}-git-worktree`)
      yield* Effect.addFinalizer(() => Effect.promise(() => fs.rm(worktree, { recursive: true, force: true })))
      const git = yield* Git.Service
      const repo = yield* git.repo.discover(directory)
      if (!repo) throw new Error("Repository not found")

      yield* git.worktree.create({ repository: repo, directory: worktree })

      expect((yield* git.worktree.list(repo)).some((entry) => entry.directory.endsWith("-git-worktree"))).toBe(true)
      const linked = yield* git.repo.discover(worktree)
      expect(linked?.worktree).toBe(AbsolutePath.make(yield* Effect.promise(() => fs.realpath(worktree))))
      expect(linked?.commonDirectory).toBe(repo.commonDirectory)
      expect(linked?.gitDirectory).not.toBe(repo.gitDirectory)
      if (!linked) throw new Error("Linked worktree not found")
      yield* git.worktree.remove({ repository: linked, directory: worktree, force: false })
      expect((yield* git.worktree.list(repo)).some((entry) => entry.directory.endsWith("-git-worktree"))).toBe(false)
    }),
  )
})

describe("Git trees", () => {
  ;[0, 1, 128].forEach((exitCode) => {
    it.live(`refresh handles check-ignore exit ${exitCode}`, () =>
      Effect.gen(function* () {
        const root = yield* Effect.acquireRelease(
          Effect.promise(() => tmpdir()),
          (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
        )
        const project = path.join(root.path, "project")
        const paths = ["scope/allowed.txt", "scope/ignored name.txt"].map((file) => RelativePath.make(file))
        yield* Effect.promise(async () => {
          await fs.mkdir(path.join(project, "scope"), { recursive: true })
          await initRepo(project)
          await Promise.all(paths.map((file) => Bun.write(path.join(project, file), "one\n")))
          await $`git add .`.cwd(project).quiet()
          await $`git commit -m initial`.cwd(project).quiet()
        })
        const git = yield* Git.Service
        const source = yield* git.repo.discover(AbsolutePath.make(project))
        if (!source) throw new Error("Repository not found")
        const repository = yield* git.repo.create({
          worktree: source.worktree,
          gitDirectory: AbsolutePath.make(path.join(root.path, "storage")),
          seed: source,
        })
        const before = yield* git.tree.write(repository)
        yield* Effect.promise(async () => {
          await Promise.all(paths.map((file) => Bun.write(path.join(project, file), "two\n")))
          await Bun.write(path.join(source.gitDirectory, "info", "exclude"), exitCode === 0 ? `${paths[1]}\n` : "")
          if (exitCode === 128) await Bun.write(path.join(source.gitDirectory, "config"), "[broken\n")
          // A broken config makes git exit before reading stdin, so piping a Buffer races an EPIPE on the writer.
          const stdin = exitCode === 128 ? Bun.file("/dev/null") : Buffer.from(paths.join("\0") + "\0")
          const result =
            await $`git --git-dir ${source.gitDirectory} --work-tree ${source.worktree} check-ignore --no-index --stdin -z < ${stdin}`
              .cwd(project)
              .quiet()
              .nothrow()
          expect(result.exitCode).toBe(exitCode)
        })
        const refresh = git.index.refresh({ repository, scope: RelativePath.make("scope"), ignores: source })
        if (exitCode === 128) {
          const error = yield* refresh.pipe(Effect.flip)
          expect(error).toBeInstanceOf(Git.OperationError)
          expect(error.message).toContain("bad config line")
          expect(yield* git.tree.write(repository)).toBe(before)
          expect(
            yield* git.index.refresh({ repository, scope: RelativePath.make("missing"), ignores: source }),
          ).toEqual({ skipped: [] })
          return
        }
        expect(yield* git.index.ignored({ repository: source, paths })).toEqual(
          new Set(exitCode === 0 ? [paths[1]] : []),
        )
        expect(yield* refresh).toEqual({ skipped: [] })
        const after = yield* git.tree.write(repository)
        expect((yield* git.tree.diff({ repository, from: before, to: after })).map((file) => file.status)).toEqual([
          "modified",
          exitCode === 0 ? "deleted" : "modified",
        ])
      }),
    )
  })

  it.live("lists both sides of a rename as separate file changes", () =>
    Effect.gen(function* () {
      const root = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(async () => {
        await initRepo(root.path)
        await $`git config diff.renames true`.cwd(root.path).quiet()
        await Bun.write(path.join(root.path, "old name.txt"), "Preserve this content.\n")
      })
      const git = yield* Git.Service
      const repository = yield* git.repo.discover(AbsolutePath.make(root.path))
      if (!repository) throw new Error("Repository not found")
      const before = yield* git.tree.capture({ repository, scopes: [RelativePath.make(".")] })
      yield* Effect.promise(() => fs.rename(path.join(root.path, "old name.txt"), path.join(root.path, "new name.txt")))
      const after = yield* git.tree.capture({ repository, scopes: [RelativePath.make(".")] })

      expect(yield* git.tree.files({ repository, from: before, to: after })).toEqual([
        RelativePath.make("new name.txt"),
        RelativePath.make("old name.txt"),
      ])
      expect(
        (yield* git.tree.diff({ repository, from: before, to: after })).map((file) => [file.file, file.status]),
      ).toEqual([
        ["new name.txt", "added"],
        ["old name.txt", "deleted"],
      ])
    }),
  )

  it.live("caps batched tree patches, keeps per-file stats past the cap, and matches non-ASCII names", () =>
    Effect.gen(function* () {
      const root = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => initRepo(root.path))
      const git = yield* Git.Service
      const repository = yield* git.repo.discover(AbsolutePath.make(root.path))
      if (!repository) throw new Error("Repository not found")
      const before = yield* git.tree.capture({ repository, scopes: [RelativePath.make(".")] })
      const lines = Math.ceil(VcsPatch.MAX_TOTAL_PATCH_BYTES / 80) + 1
      yield* Effect.promise(async () => {
        await Bun.write(path.join(root.path, "a-small.txt"), "small\n")
        await Bun.write(path.join(root.path, "b-large.txt"), `${"x".repeat(79)}\n`.repeat(lines))
        await Bun.write(path.join(root.path, "c-binary.bin"), new Uint8Array([0, 1, 2, 3]))
        await Bun.write(path.join(root.path, "a-caf\u00e9.txt"), "caf\u00e9\n")
      })
      const after = yield* git.tree.capture({ repository, scopes: [RelativePath.make(".")] })

      const diffs = yield* git.tree.diff({ repository, from: before, to: after, context: 0 })
      expect(diffs.map((item) => [item.file, item.status, item.additions, item.deletions])).toEqual([
        ["a-caf\u00e9.txt", "added", 1, 0],
        ["a-small.txt", "added", 1, 0],
        ["b-large.txt", "added", lines, 0],
        ["c-binary.bin", "added", 0, 0],
      ])
      // Patch headers are not NUL-delimited; a quoted (octal-escaped) header would orphan this chunk.
      expect(diffs[0]?.patch).toContain("+caf\u00e9\n")
      expect(diffs[1]?.patch).toContain("+small\n")
      expect(diffs[2]?.patch).toBe(VcsPatch.emptyPatch("b-large.txt"))
      expect(diffs[3]?.patch).toBe("")
      expect(yield* git.tree.diff({ repository, from: before, to: after, paths: [] })).toEqual([])
    }),
  )

  it.live(
    "diffs a path selection longer than any platform command line",
    () =>
      Effect.gen(function* () {
        const root = yield* Effect.acquireRelease(
          Effect.promise(() => tmpdir()),
          (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
        )
        yield* Effect.promise(async () => {
          await initRepo(root.path)
          await fs.mkdir(path.join(root.path, "dir", "nested"), { recursive: true })
          await Bun.write(path.join(root.path, "changed.txt"), "before\n")
          await Bun.write(path.join(root.path, "removed.txt"), "removed\n")
          await Bun.write(path.join(root.path, "dir", "nested", "file.txt"), "before\n")
        })
        const git = yield* Git.Service
        const repository = yield* git.repo.discover(AbsolutePath.make(root.path))
        if (!repository) throw new Error("Repository not found")
        const before = yield* git.tree.capture({ repository, scopes: [RelativePath.make(".")] })
        yield* Effect.promise(async () => {
          await Bun.write(path.join(root.path, "changed.txt"), "after\n")
          await fs.rm(path.join(root.path, "removed.txt"))
          await Bun.write(path.join(root.path, "dir", "nested", "file.txt"), "after\n")
          await Bun.write(path.join(root.path, "first.txt"), "first\n")
          await Bun.write(path.join(root.path, "last.txt"), "last\n")
          await Bun.write(path.join(root.path, "unselected.txt"), "unselected\n")
        })
        const after = yield* git.tree.capture({ repository, scopes: [RelativePath.make(".")] })
        const missing = Array.from({ length: 30_000 }, (_, index) =>
          RelativePath.make(`missing/${String(index).padStart(6, "0")}/${"x".repeat(80)}.txt`),
        )
        const paths = ["first.txt", "changed.txt", "removed.txt", "dir", ...missing, "last.txt"].map((file) =>
          RelativePath.make(file),
        )

        const diffs = yield* git.tree.diff({ repository, from: before, to: after, paths })
        expect(diffs.map((item) => [item.file, item.status, item.additions, item.deletions])).toEqual([
          ["changed.txt", "modified", 1, 1],
          ["dir/nested/file.txt", "modified", 1, 1],
          ["first.txt", "added", 1, 0],
          ["last.txt", "added", 1, 0],
          ["removed.txt", "deleted", 0, 1],
        ])
        expect(diffs[0]?.patch).toContain("-before\n+after\n")
        expect(diffs[2]?.patch).toContain("+first\n")
        expect(diffs[4]?.patch).toContain("-removed\n")
        expect(yield* git.tree.diff({ repository, from: before, to: after, paths: missing })).toEqual([])
        expect(yield* git.tree.write(repository)).toBe(after)
      }),
    { timeout: 60_000 },
  )

  it.live("captures, compares, previews, and restores scoped trees", () =>
    Effect.gen(function* () {
      const root = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(async () => {
        await initRepo(root.path)
        await fs.mkdir(path.join(root.path, "scope"))
        await fs.writeFile(path.join(root.path, "scope", "tracked.txt"), "one\n")
        await fs.writeFile(path.join(root.path, "outside.txt"), "outside\n")
        await $`git add .`.cwd(root.path).quiet()
        await $`git commit -m initial`.cwd(root.path).quiet()
      })
      const git = yield* Git.Service
      const source = yield* git.repo.discover(AbsolutePath.make(root.path))
      if (!source) throw new Error("Repository not found")
      const storage = AbsolutePath.make(path.join(root.path, ".snapshot storage"))
      const repository = yield* git.repo.create({ worktree: source.worktree, gitDirectory: storage, seed: source })
      yield* Effect.promise(() => $`git --git-dir ${storage} config --add include.path first.gitconfig`.quiet())
      yield* Effect.promise(() => $`git --git-dir ${storage} config --add include.path second.gitconfig`.quiet())
      yield* Effect.promise(() => $`git --git-dir ${storage} config core.autocrlf true`.quiet())
      yield* git.repo.create({ worktree: source.worktree, gitDirectory: storage, seed: source })
      expect(
        yield* Effect.promise(() => $`git --git-dir ${storage} config --local --includes core.autocrlf`.text()),
      ).toBe("false\n")
      expect(
        (yield* Effect.promise(() => fs.readFile(path.join(storage, "config"), "utf8"))).match(/opencode\.gitconfig/g),
      ).toHaveLength(1)
      expect(
        yield* Effect.promise(() => $`git --git-dir ${storage} config --local --get-all include.path`.text()),
      ).toBe("opencode.gitconfig\nfirst.gitconfig\nsecond.gitconfig\n")
      yield* git.index.refresh({ repository, scope: RelativePath.make("scope") })
      const before = yield* git.tree.write(repository)

      yield* Effect.promise(async () => {
        await fs.writeFile(path.join(root.path, "scope", "tracked.txt"), "two\n")
        await fs.writeFile(path.join(root.path, "scope", "added.txt"), "added\n")
        await fs.writeFile(path.join(root.path, "outside.txt"), "changed outside\n")
      })
      yield* git.index.refresh({ repository, scope: RelativePath.make("scope") })
      const after = yield* git.tree.write(repository)

      expect(yield* git.tree.files({ repository, from: before, to: after })).toEqual([
        RelativePath.make("scope/added.txt"),
        RelativePath.make("scope/tracked.txt"),
      ])
      const diffs = yield* git.tree.diff({ repository, from: before, to: after, context: 1 })
      expect(diffs.map((item) => [item.file, item.status])).toEqual([
        [RelativePath.make("scope/added.txt"), "added"],
        [RelativePath.make("scope/tracked.txt"), "modified"],
      ])

      const files = new Map([[RelativePath.make("scope/tracked.txt"), before]])
      yield* git.tree.restore({ repository, files })
      expect(yield* read(path.join(root.path, "scope", "tracked.txt"))).toBe("one\n")
      expect(yield* read(path.join(root.path, "scope", "added.txt"))).toBe("added\n")
      expect(yield* read(path.join(root.path, "outside.txt"))).toBe("changed outside\n")
    }),
  )
})

describe("Git objects", () => {
  it.live(
    "packs loose objects and combines packs without losing or delegating any object",
    () =>
      Effect.gen(function* () {
        const root = yield* Effect.acquireRelease(
          Effect.promise(() => tmpdir()),
          (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
        )
        const project = path.join(root.path, "project")
        yield* Effect.promise(async () => {
          await fs.mkdir(project)
          await initRepo(project)
          await Bun.write(path.join(project, "seed.txt"), "seed\n")
          await $`git add . && git commit -q -m initial`.cwd(project).quiet()
        })
        const git = yield* Git.Service
        const source = yield* git.repo.discover(AbsolutePath.make(project))
        if (!source) throw new Error("Repository not found")
        const repository = yield* git.repo.create({
          worktree: source.worktree,
          gitDirectory: AbsolutePath.make(path.join(root.path, "storage")),
          seed: source,
        })
        const capture = () => git.tree.capture({ repository, scopes: [RelativePath.make(".")], ignores: source })
        const trees = [yield* capture()]
        // Enough distinct content to cross the loose-object threshold.
        yield* Effect.promise(() =>
          Promise.all(
            Array.from({ length: 2100 }, (_, index) =>
              Bun.write(path.join(project, `gen/d${index % 20}/f${index}.txt`), `${index}\n`),
            ),
          ),
        )
        trees.push(yield* capture())
        const objects = path.join(repository.gitDirectory, "objects")
        const alternates = path.join(objects, "info", "alternates")
        // Objects stored in the snapshot repository itself, excluding anything borrowed through alternates.
        const everything = () =>
          Effect.promise(async () => {
            const borrowed = await fs.readFile(alternates, "utf8")
            await fs.rm(alternates)
            const listed =
              await $`git --git-dir ${repository.gitDirectory} cat-file --batch-all-objects ${"--batch-check=%(objectname)"}`.text()
            await fs.writeFile(alternates, borrowed)
            return listed.split("\n").filter(Boolean).toSorted()
          })
        const loose = () => Effect.promise(() => looseObjectIDs(objects))
        const before = yield* everything()
        expect((yield* loose()).length).toBeGreaterThan(2048)

        yield* git.objects.pack(repository)
        expect(yield* loose()).toEqual([])
        expect(yield* everything()).toEqual(before)

        for (let batch = 0; batch < 16; batch++) {
          yield* Effect.promise(() => Bun.write(path.join(project, `batch-${batch}.txt`), `${batch}\n`))
          trees.push(yield* capture())
          yield* Effect.promise(async () => {
            const list = await looseObjectIDs(objects)
            await $`git --git-dir ${repository.gitDirectory} pack-objects -q ${path.join(objects, "pack", "pack")} < ${Buffer.from(list.join("\n") + "\n")}`.quiet()
            await $`git --git-dir ${repository.gitDirectory} prune-packed`.quiet()
          })
        }
        const packs = () =>
          Effect.promise(async () =>
            (await fs.readdir(path.join(objects, "pack"))).filter((file) => file.endsWith(".pack")),
          )
        expect((yield* packs()).length).toBeGreaterThanOrEqual(16)
        const merged = yield* everything()

        yield* git.objects.pack(repository)
        expect((yield* packs()).length).toBe(1)
        expect(yield* everything()).toEqual(merged)

        expect((yield* git.tree.files({ repository, from: trees[0]!, to: trees.at(-1)! })).length).toBe(2100 + 16)
      }),
    { timeout: 60_000 },
  )
})

describe("Git capture", () => {
  it.live("applies both the store's own and the source's ignore rules and never splits the index", () =>
    Effect.gen(function* () {
      const root = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
      )
      const project = path.join(root.path, "project")
      yield* Effect.promise(async () => {
        await fs.mkdir(project)
        await initRepo(project)
        await Bun.write(path.join(project, "tracked.bin"), "small\n")
        await $`git add . && git commit -q -m initial`.cwd(project).quiet()
        await Bun.write(path.join(project, ".git", "info", "exclude"), "source-ignored/\n")
      })
      const git = yield* Git.Service
      const source = yield* git.repo.discover(AbsolutePath.make(project))
      if (!source) throw new Error("Repository not found")
      const storage = AbsolutePath.make(path.join(root.path, "storage"))
      const repository = yield* git.repo.create({ worktree: source.worktree, gitDirectory: storage, seed: source })
      yield* Effect.promise(async () => {
        // Rules an init template left in the store keep applying, and a split index would lose entries.
        await Bun.write(path.join(storage, "info", "exclude"), "store-ignored/\n")
        await $`git --git-dir ${storage} config core.splitIndex true`.quiet()
      })
      const capture = () => git.tree.capture({ repository, scopes: [RelativePath.make(".")], ignores: source })
      const before = yield* capture()
      yield* Effect.promise(async () => {
        await Bun.write(path.join(project, "tracked.bin"), "changed\n")
        await Bun.write(path.join(project, "store-ignored", "a.txt"), "a\n")
        await Bun.write(path.join(project, "source-ignored", "b.txt"), "b\n")
        await Bun.write(path.join(project, "kept.txt"), "kept\n")
      })
      const after = yield* capture()
      expect(yield* git.tree.files({ repository, from: before, to: after })).toEqual([
        RelativePath.make("kept.txt"),
        RelativePath.make("tracked.bin"),
      ])
      expect(yield* capture()).toBe(after)
      expect(yield* Effect.promise(() => fs.readFile(path.join(storage, "info", "exclude"), "utf8"))).toStartWith(
        "store-ignored/\n",
      )
    }),
  )
})

describe("Git capture recovery", () => {
  const setup = Effect.gen(function* () {
    const root = yield* Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    )
    const project = path.join(root.path, "project")
    yield* Effect.promise(async () => {
      await fs.mkdir(project)
      await initRepo(project)
      await Bun.write(path.join(project, "a.txt"), "a\n")
      await Bun.write(path.join(project, "b.txt"), "b\n")
      await $`git add . && git commit -q -m initial`.cwd(project).quiet()
    })
    const git = yield* Git.Service
    const source = yield* git.repo.discover(AbsolutePath.make(project))
    if (!source) throw new Error("Repository not found")
    const repository = yield* git.repo.create({
      worktree: source.worktree,
      gitDirectory: AbsolutePath.make(path.join(root.path, "storage")),
      seed: source,
    })
    const capture = () => git.tree.capture({ repository, scopes: [RelativePath.make(".")], ignores: source })
    return { root, project, repository, capture }
  })

  it.live("sweeps abandoned temporary indexes by their creation time, not their mtime", () =>
    Effect.gen(function* () {
      const { repository, capture } = yield* setup
      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000
      const live = path.join(repository.gitDirectory, `index.opencode-${Date.now()}-1-live`)
      const abandoned = path.join(repository.gitDirectory, `index.opencode-${twoHoursAgo}-1-abandoned`)
      yield* Effect.promise(async () => {
        await Bun.write(live, "")
        await Bun.write(abandoned, "")
        // A hard link to an index nobody wrote for hours carries that old mtime while in use.
        await fs.utimes(live, new Date(twoHoursAgo), new Date(twoHoursAgo))
      })
      yield* capture()
      expect(yield* Effect.promise(() => Bun.file(live).exists())).toBe(true)
      expect(yield* Effect.promise(() => Bun.file(abandoned).exists())).toBe(false)
    }),
  )

  it.live("records a tracked file replaced by an embedded repository as a gitlink", () =>
    Effect.gen(function* () {
      const { project, repository, capture } = yield* setup
      yield* capture()
      yield* Effect.promise(async () => {
        await fs.rm(path.join(project, "a.txt"))
        await Bun.write(path.join(project, "a.txt", "inner.txt"), "inner\n")
        await initRepo(path.join(project, "a.txt"))
        await $`git add . && git commit -q -m inner`.cwd(path.join(project, "a.txt")).quiet()
      })
      const tree = yield* capture()
      const entry = yield* Effect.promise(() =>
        $`git --git-dir ${repository.gitDirectory} ls-tree ${tree} a.txt`.text(),
      )
      expect(entry).toStartWith("160000 commit ")
    }),
  )

  it.live("keeps the index when Git cannot even start", () =>
    Effect.gen(function* () {
      const { root, project, repository, capture } = yield* setup
      const before = yield* capture()
      const moved = path.join(root.path, "moved")
      yield* Effect.promise(() => fs.rename(project, moved))
      expect(Exit.isFailure(yield* capture().pipe(Effect.exit))).toBe(true)
      yield* Effect.promise(() => fs.rename(moved, project))
      expect(yield* Effect.promise(() => Bun.file(path.join(repository.gitDirectory, "index")).exists())).toBe(true)
      expect(yield* capture()).toBe(before)
    }),
  )
})

async function looseObjectIDs(objects: string) {
  const prefixes = (await fs.readdir(objects)).filter((entry) => /^[0-9a-f]{2}$/.test(entry))
  const listed = await Promise.all(
    prefixes.map(async (prefix) => (await fs.readdir(path.join(objects, prefix))).map((entry) => prefix + entry)),
  )
  return listed.flat()
}
