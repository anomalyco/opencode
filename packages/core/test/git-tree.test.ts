import { $ } from "bun"
import { describe, expect } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { Git } from "@opencode-ai/core/git"
import { AbsolutePath, RelativePath } from "@opencode-ai/core/schema"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { initRepo } from "./fixture/git"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.compile(Git.node))

const write = (directory: string, files: Record<string, string | Uint8Array>) =>
  Effect.promise(() =>
    Promise.all(
      Object.entries(files).map(async ([file, content]) => {
        await fs.mkdir(path.dirname(path.join(directory, file)), { recursive: true })
        await Bun.write(path.join(directory, file), content)
      }),
    ),
  )

const fixture = Effect.fnUntraced(function* (files: Record<string, string | Uint8Array>) {
  const tmp = yield* tmpdirScoped()
  const directory = path.join(tmp.path, "project")
  yield* Effect.promise(async () => {
    await fs.mkdir(directory)
    await initRepo(directory)
  })
  yield* write(directory, files)
  const git = yield* Git.Service
  const source = yield* git.repo.discover(AbsolutePath.make(directory))
  if (!source) throw new Error("Repository not found")
  const repository = yield* git.repo.create({
    worktree: source.worktree,
    gitDirectory: AbsolutePath.make(path.join(tmp.path, "snapshot")),
    seed: source,
  })
  const capture = () => git.tree.capture({ repository, scopes: [RelativePath.make(".")] })
  return { git, repository, directory, capture, before: yield* capture() }
})

describe("Git tree batches", () => {
  it.live(
    "preserves per-file patches, requested ordering, binary stats, and empty changes",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture({
          "changed.txt": "first\nbefore\nlast\n",
          "deleted.txt": "deleted\n",
          "unchanged.txt": "unchanged\n",
          "binary.bin": new Uint8Array([0, 1, 2]),
          "café 🦊.txt": "unicode before\n",
          "nested/space name.txt": "space before\n",
        })
        yield* write(f.directory, {
          "changed.txt": "first\nafter\nlast\n",
          "added.txt": "added\n",
          "empty.txt": "",
          "binary.bin": new Uint8Array([0, 3, 4]),
          "café 🦊.txt": "unicode after\n",
          "nested/space name.txt": "space after\n",
        })
        yield* Effect.promise(() => fs.unlink(path.join(f.directory, "deleted.txt")))
        const after = yield* f.capture()
        const paths = [
          "nested/space name.txt",
          "café 🦊.txt",
          "binary.bin",
          "empty.txt",
          "added.txt",
          "deleted.txt",
          "changed.txt",
          "unchanged.txt",
        ].map((file) => RelativePath.make(file))
        const diffs = yield* f.git.tree.diff({ repository: f.repository, from: f.before, to: after, paths, context: 1 })
        expect(diffs.map((diff) => [diff.file, diff.status, diff.additions, diff.deletions])).toEqual([
          [paths[0], "modified", 1, 1],
          [paths[1], "modified", 1, 1],
          [paths[2], "modified", 0, 0],
          [paths[3], "added", 0, 0],
          [paths[4], "added", 1, 0],
          [paths[5], "deleted", 0, 1],
          [paths[6], "modified", 1, 1],
          [paths[7], "modified", 0, 0],
        ])
        for (const diff of diffs) {
          if (diff.file === "binary.bin") {
            expect(diff.patch).toBe("")
            continue
          }
          const expected = yield* Effect.promise(() =>
            $`git --git-dir ${f.repository.gitDirectory} --work-tree ${f.directory} diff --unified=1 --no-renames ${f.before} ${after} -- ${diff.file}`
              .cwd(f.directory)
              .text(),
          )
          expect(diff.patch).toBe(expected)
        }
        expect(yield* f.git.tree.diff({ repository: f.repository, from: f.before, to: after, paths: [] })).toEqual([])
        expect(yield* f.git.tree.diff({ repository: f.repository, from: after, to: after })).toEqual([])
      }),
    { timeout: 30_000 },
  )
  ;(process.platform === "win32" ? it.live.skip : it.live)(
    "keeps C-quoted paths and type changes paired with the correct patch",
    () =>
      Effect.gen(function* () {
        const names = ["tab\tname.txt", "line\nname.txt", 'quote"name.txt', "back\\slash.txt", "bell\x07.txt"]
        const f = yield* fixture({
          ...Object.fromEntries(names.map((file) => [file, "before\n"])),
          "kind.txt": "was a file\n",
          "path b/nested/mode.txt": "executable\n",
          "café-mode.txt": "executable\n",
          tab: "before\n",
          "tab\tmode.txt": "executable\n",
        })
        yield* write(f.directory, { ...Object.fromEntries(names.map((file) => [file, "after\n"])), tab: "after\n" })
        yield* Effect.promise(async () => {
          await fs.unlink(path.join(f.directory, "kind.txt"))
          await fs.symlink("café-mode.txt", path.join(f.directory, "kind.txt"))
          await fs.chmod(path.join(f.directory, "path b/nested/mode.txt"), 0o755)
          await fs.chmod(path.join(f.directory, "café-mode.txt"), 0o755)
          await fs.chmod(path.join(f.directory, "tab\tmode.txt"), 0o755)
        })
        const after = yield* f.capture()
        const diffs = yield* f.git.tree.diff({ repository: f.repository, from: f.before, to: after })
        expect(diffs).toHaveLength(names.length + 5)
        for (const diff of diffs) {
          const expected = yield* Effect.promise(() =>
            $`git --git-dir ${f.repository.gitDirectory} --work-tree ${f.directory} diff --no-renames ${f.before} ${after} -- ${diff.file}`
              .cwd(f.directory)
              .text(),
          )
          expect(diff.patch).toBe(expected)
        }
        yield* f.git.tree.restore({
          repository: f.repository,
          files: new Map(diffs.map((diff) => [RelativePath.make(diff.file), f.before])),
        })
        for (const file of names)
          expect(yield* Effect.promise(() => Bun.file(path.join(f.directory, file)).text())).toBe("before\n")
        expect(yield* Effect.promise(() => Bun.file(path.join(f.directory, "kind.txt")).text())).toBe("was a file\n")
        expect((yield* Effect.promise(() => fs.stat(path.join(f.directory, "café-mode.txt")))).mode & 0o111).toBe(0)
      }),
    { timeout: 30_000 },
  )

  it.live(
    "keeps Git display configuration from mixing neighboring patches",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture({ foo: "before\n", "a/foo": "before\n" })
        yield* Effect.promise(() =>
          $`git --git-dir ${f.repository.gitDirectory} update-index --add --cacheinfo ${`160000,${"1".repeat(40)},z-module`}`
            .cwd(f.directory)
            .quiet(),
        )
        const before = yield* f.git.tree.write(f.repository)
        yield* write(f.directory, { foo: "after\n", "a/foo": "after\n" })
        yield* f.capture()
        yield* Effect.promise(async () => {
          await $`git --git-dir ${f.repository.gitDirectory} update-index --add --cacheinfo ${`160000,${"2".repeat(40)},z-module`}`
            .cwd(f.directory)
            .quiet()
          await $`git --git-dir ${f.repository.gitDirectory} config diff.noprefix true`.cwd(f.directory).quiet()
          await $`git --git-dir ${f.repository.gitDirectory} config diff.submodule log`.cwd(f.directory).quiet()
        })
        const after = yield* f.git.tree.write(f.repository)
        const diffs = yield* f.git.tree.diff({ repository: f.repository, from: before, to: after })
        expect(diffs.map((diff) => diff.file)).toEqual(["a/foo", "foo", "z-module"])
        for (const diff of diffs) {
          const expected = yield* Effect.promise(() =>
            $`git --git-dir ${f.repository.gitDirectory} --work-tree ${f.directory} diff --no-renames --src-prefix=a/ --dst-prefix=b/ --submodule=short ${before} ${after} -- ${diff.file}`
              .cwd(f.directory)
              .text(),
          )
          expect(diff.patch).toBe(expected)
        }
      }),
    { timeout: 30_000 },
  )

  it.live(
    "preserves restoration order across snapshots and overlapping directory paths",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture({ "alpha.txt": "one\n", "folder/file.txt": "one\n", "untouched.txt": "one\n" })
        yield* write(f.directory, { "alpha.txt": "two\n", "folder/file.txt": "two\n" })
        const middle = yield* f.capture()
        yield* write(f.directory, {
          "alpha.txt": "three\n",
          "folder/file.txt": "three\n",
          "untouched.txt": "keep this edit\n",
          "added.txt": "remove this\n",
        })
        yield* f.git.tree.restore({
          repository: f.repository,
          files: new Map([
            [RelativePath.make("alpha.txt"), f.before],
            [RelativePath.make("folder/file.txt"), middle],
            [RelativePath.make("folder"), f.before],
            [RelativePath.make("added.txt"), f.before],
          ]),
        })
        expect(yield* Effect.promise(() => Bun.file(path.join(f.directory, "alpha.txt")).text())).toBe("one\n")
        expect(yield* Effect.promise(() => Bun.file(path.join(f.directory, "folder/file.txt")).text())).toBe("one\n")
        expect(yield* Effect.promise(() => Bun.file(path.join(f.directory, "untouched.txt")).text())).toBe(
          "keep this edit\n",
        )
        expect(yield* Effect.promise(() => Bun.file(path.join(f.directory, "added.txt")).exists())).toBe(false)
      }),
    { timeout: 30_000 },
  )

  it.live(
    "treats selected bracketed filenames literally",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture({ "app/[slug]/page.tsx": "before\n", "app/s/page.tsx": "original\n" })
        yield* write(f.directory, { "app/[slug]/page.tsx": "after\n", "app/s/page.tsx": "keep this edit\n" })
        const after = yield* f.capture()
        const file = RelativePath.make("app/[slug]/page.tsx")
        const diffs = yield* f.git.tree.diff({ repository: f.repository, from: f.before, to: after, paths: [file] })
        expect(diffs).toHaveLength(1)
        expect(diffs[0].patch).toContain("+after")
        expect(diffs[0].patch).not.toContain("keep this edit")
        yield* f.git.tree.restore({ repository: f.repository, files: new Map([[file, f.before]]) })
        expect(yield* Effect.promise(() => Bun.file(path.join(f.directory, file)).text())).toBe("before\n")
        expect(yield* Effect.promise(() => Bun.file(path.join(f.directory, "app/s/page.tsx")).text())).toBe(
          "keep this edit\n",
        )
      }),
    { timeout: 30_000 },
  )

  it.live(
    "normalizes explicit paths before matching tree entries",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture({ "changed.txt": "before\n", "folder/file.txt": "before\n" })
        yield* write(f.directory, { "changed.txt": "after\n", "folder/file.txt": "after\n" })
        const after = yield* f.capture()
        const file = RelativePath.make("./changed.txt")
        const diffs = yield* f.git.tree.diff({ repository: f.repository, from: f.before, to: after, paths: [file] })
        expect(diffs.map((diff) => [diff.file, diff.additions, diff.deletions])).toEqual([[file, 1, 1]])
        yield* f.git.tree.restore({
          repository: f.repository,
          files: new Map([
            [file, f.before],
            [RelativePath.make("folder/"), f.before],
            [RelativePath.make("folder/file.txt"), f.before],
          ]),
        })
        expect(yield* Effect.promise(() => Bun.file(path.join(f.directory, "changed.txt")).text())).toBe("before\n")
        expect(yield* Effect.promise(() => Bun.file(path.join(f.directory, "folder/file.txt")).text())).toBe("before\n")
      }),
    { timeout: 30_000 },
  )

  it.live(
    "handles path lists larger than one command without touching unselected files",
    () =>
      Effect.gen(function* () {
        const names = Array.from(
          { length: 140 },
          (_, index) => `${String(index).padStart(3, "0")}-${"x".repeat(130)}.txt`,
        )
        const f = yield* fixture({
          ...Object.fromEntries(names.map((file) => [file, "before\n"])),
          "unselected.txt": "original\n",
        })
        yield* write(f.directory, {
          ...Object.fromEntries(names.map((file) => [file, "after\n"])),
          "unselected.txt": "keep this edit\n",
        })
        const after = yield* f.capture()
        const paths = names.toReversed().map((file) => RelativePath.make(file))
        const diffs = yield* f.git.tree.diff({ repository: f.repository, from: f.before, to: after, paths })
        expect(diffs.map((diff) => diff.file)).toEqual(paths)
        expect(
          diffs.every((diff) => diff.additions === 1 && diff.deletions === 1 && diff.patch.includes("+after")),
        ).toBe(true)
        yield* f.git.tree.restore({ repository: f.repository, files: new Map(paths.map((file) => [file, f.before])) })
        for (const file of names)
          expect(yield* Effect.promise(() => Bun.file(path.join(f.directory, file)).text())).toBe("before\n")
        expect(yield* Effect.promise(() => Bun.file(path.join(f.directory, "unselected.txt")).text())).toBe(
          "keep this edit\n",
        )
      }),
    { timeout: 30_000 },
  )
})
