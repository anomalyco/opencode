import { $ } from "bun"
import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Cause, Effect, Exit, Fiber, Layer, Stream } from "effect"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { AppProcess } from "@opencode-ai/util/process"
import { Bus } from "@opencode-ai/core/bus"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Vcs } from "@opencode-ai/core/vcs"
import { VcsGitPlugin } from "@opencode-ai/core/plugin/vcs/git"
import type { VcsDefinition, VcsDiffInput } from "@opencode-ai/plugin/effect/vcs"
import { FileSystem } from "@opencode-ai/schema/filesystem"
import { VcsEvent } from "@opencode-ai/schema/vcs-event"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { it } from "./lib/effect"
import { host } from "./plugin/host"

const provide = (directory: string, input: { git?: boolean; worktree?: string } = {}) =>
  Effect.provide(
    LayerNode.compile(LayerNode.group([Vcs.node, Bus.node, Location.node, AppProcess.node]), [
      [
        Location.node,
        Layer.succeed(
          Location.Service,
          Location.Service.of(
            location(
              { directory: AbsolutePath.make(directory) },
              {
                projectDirectory: input.worktree ? AbsolutePath.make(input.worktree) : undefined,
                ...(input.git
                  ? { vcs: { type: "git", store: AbsolutePath.make(path.join(input.worktree ?? directory, ".git")) } }
                  : {}),
              },
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

const withGit = <A, E, R>(
  f: (directory: string) => Effect.Effect<A, E, R>,
  input: { scope?: string; gh?: AppProcess.Interface["run"] } = {},
) =>
  withTmp((directory) =>
    Effect.promise(async () => {
      await initRepo(directory)
      if (input.scope) await fs.mkdir(path.join(directory, input.scope), { recursive: true })
    }).pipe(
      Effect.andThen(
        Effect.gen(function* () {
          const vcs = yield* Vcs.Service
          const processes = yield* AppProcess.Service
          const context = host()
          yield* VcsGitPlugin.Plugin.effect({
            ...context,
            vcs: { ...context.vcs, transform: vcs.transform, reload: vcs.reload },
          }).pipe(
            Effect.provideService(AppProcess.Service, {
              ...processes,
              run: (command, options) =>
                command._tag === "StandardCommand" && command.command === "gh"
                  ? (input.gh?.(command, options) ??
                    Effect.fail(new AppProcess.AppProcessError({ command: "gh", cause: new Error("not installed") })))
                  : processes.run(command, options),
            }),
          )
          return yield* f(directory)
        }).pipe(provide(path.join(directory, input.scope ?? "."), { git: true, worktree: directory })),
      ),
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

const provider = (input: Partial<VcsDefinition> = {}) =>
  ({
    id: "custom",
    name: "Custom VCS",
    info: () => Effect.succeed({ branch: { current: "feature", default: "main" } }),
    branches: () => Effect.succeed(["feature", "main"]),
    status: () => Effect.succeed([{ file: "file.txt", additions: 1, deletions: 0, status: "added" }]),
    diff: () => Effect.succeed([{ file: "file.txt", patch: "+hello", additions: 1, deletions: 0, status: "added" }]),
    ...input,
  }) satisfies VcsDefinition

describe("Vcs", () => {
  it.live("returns empty results outside version control", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const vcs = yield* Vcs.Service
        expect(yield* vcs.info()).toEqual({ branch: {} })
        expect(yield* vcs.branches()).toEqual([])
        expect(yield* vcs.base()).toBeNull()
        expect(yield* vcs.status()).toEqual([])
        expect(yield* vcs.diff("working")).toEqual([])
        expect(yield* vcs.diff("branch")).toEqual([])
      }).pipe(provide(directory)),
    ),
  )

  it.live("serves scoped providers and restores the fallback after disposal", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const vcs = yield* Vcs.Service
        const registration = yield* vcs.transform((draft) => {
          draft.add(provider())
          draft.default.set("custom")
        })

        expect(yield* vcs.info()).toEqual({ branch: { current: "feature", default: "main" } })
        expect(yield* vcs.base()).toBeNull()
        expect(yield* vcs.branches()).toEqual(["feature", "main"])
        expect(yield* vcs.status()).toEqual([{ file: "file.txt", additions: 1, deletions: 0, status: "added" }])
        expect(yield* vcs.diff("working")).toEqual([
          { file: "file.txt", patch: "+hello", additions: 1, deletions: 0, status: "added" },
        ])

        yield* registration.dispose
        expect(yield* vcs.info()).toEqual({ branch: {} })
        expect(yield* vcs.status()).toEqual([])
      }).pipe(provide(directory)),
    ),
  )

  it.live("automatically selects a provider matching the resolved repository", () =>
    withGit(() =>
      Effect.gen(function* () {
        const vcs = yield* Vcs.Service
        const registration = yield* vcs.transform((draft) => draft.add(provider({ id: "git" })))
        expect(yield* vcs.info()).toEqual({ branch: { current: "feature", default: "main" } })

        yield* registration.dispose
        expect(yield* vcs.info()).toEqual({ branch: { current: "main", default: undefined } })
      }),
    ),
  )

  it.live("passes location scope and bounded diff options to providers", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const observed: VcsDiffInput[] = []
        const vcs = yield* Vcs.Service
        yield* vcs.transform((draft) => {
          draft.add(
            provider({
              diff: (input) =>
                Effect.sync(() => {
                  observed.push(input)
                  return [{ file: "file.txt", patch: "+hello", additions: 1, deletions: 0, status: "added" }]
                }),
            }),
          )
          draft.default.set("custom")
        })

        yield* vcs.diff("committed", { context: 3, base: "release" })
        expect(observed).toEqual([
          {
            directory,
            worktree: directory,
            canonical: directory,
            mode: "committed",
            base: "release",
            context: 3,
            maxOutputBytes: 10_000_000,
          },
        ])
      }).pipe(provide(directory)),
    ),
  )

  it.live("validates provider results and bounds oversized patches", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const vcs = yield* Vcs.Service
        yield* vcs.transform((draft) => {
          draft.add(
            provider({
              status: () => Effect.succeed([{ file: "file.txt", additions: -1, deletions: 0, status: "added" }]),
              diff: () =>
                Effect.succeed([
                  { file: "file.txt", patch: "x".repeat(10_000_001), additions: 1, deletions: 0, status: "added" },
                ]),
            }),
          )
          draft.default.set("custom")
        })

        expect(yield* vcs.status()).toEqual([])
        const rows = yield* vcs.diff("working")
        expect(rows).toHaveLength(1)
        expect(Buffer.byteLength(rows[0].patch)).toBeLessThan(1000)
        expect(rows[0].additions).toBe(1)
      }).pipe(provide(directory)),
    ),
  )

  it.live("preserves provider interruption", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const vcs = yield* Vcs.Service
        yield* vcs.transform((draft) => {
          draft.add(provider({ status: () => Effect.never, diff: () => Effect.never, base: () => Effect.never }))
          draft.default.set("custom")
        })

        const fiber = yield* Effect.forkChild(vcs.status())
        yield* Fiber.interrupt(fiber)
        const exit = yield* Fiber.await(fiber)
        expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBeTrue()
        const diff = yield* Effect.forkChild(vcs.diff("committed"))
        yield* Fiber.interrupt(diff)
        const interrupted = yield* Fiber.await(diff)
        expect(Exit.isFailure(interrupted) && Cause.hasInterrupts(interrupted.cause)).toBeTrue()
        const base = yield* Effect.forkChild(vcs.base())
        yield* Fiber.interrupt(base)
        const cancelled = yield* Fiber.await(base)
        expect(Exit.isFailure(cancelled) && Cause.hasInterrupts(cancelled.cause)).toBeTrue()
      }).pipe(provide(directory)),
    ),
  )

  it.live("lists local branches by recent activity", () =>
    withGit((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await fs.writeFile(path.join(directory, "file.txt"), "one\n")
          await commitAll(directory, "initial")
          await $`git checkout -b z-recent`.cwd(directory).quiet()
          await fs.writeFile(path.join(directory, "file.txt"), "two\n")
          await $`git add -A`.cwd(directory).quiet()
          await $`git commit -m recent`
            .cwd(directory)
            .env({
              ...process.env,
              GIT_AUTHOR_DATE: "2030-01-01T00:00:00Z",
              GIT_COMMITTER_DATE: "2030-01-01T00:00:00Z",
            })
            .quiet()
        })
        const vcs = yield* Vcs.Service
        expect(yield* vcs.branches()).toEqual(["z-recent", "main"])
        expect(yield* vcs.branches({ limit: 1 })).toEqual(["z-recent"])
        expect(yield* vcs.branches({ search: "MAIN", limit: 1 })).toEqual(["main"])
        expect(yield* vcs.branches({ search: "*" })).toEqual([])
      }),
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
        expect(yield* vcs.base()).toBeNull()
        expect(yield* vcs.diff("branch")).toEqual(diff)
        expect(yield* vcs.diff("committed")).toEqual([])
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

  it.live("separates committed, combined, and staged/unstaged/untracked working changes", () =>
    withGit((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await fs.writeFile(path.join(directory, "file.txt"), "base\n")
          await commitAll(directory, "initial")
          await $`git checkout -b feature`.cwd(directory).quiet()
          await fs.writeFile(path.join(directory, "file.txt"), "committed\n")
          await commitAll(directory, "feature")
          await fs.writeFile(path.join(directory, "staged.txt"), "staged\n")
          await $`git add staged.txt`.cwd(directory).quiet()
          await fs.writeFile(path.join(directory, "file.txt"), "unstaged\n")
          await fs.writeFile(path.join(directory, "untracked.txt"), "untracked\n")
        })
        const vcs = yield* Vcs.Service
        const committed = yield* vcs.diff("committed")
        expect(committed.map((row) => row.file)).toEqual(["file.txt"])
        expect(committed[0].patch).toContain("-base\n+committed")
        expect(committed[0]).toMatchObject({ additions: 1, deletions: 1 })
        const combined = yield* vcs.diff("branch")
        expect(combined.map((row) => row.file)).toEqual(["file.txt", "staged.txt", "untracked.txt"])
        expect(combined[0].patch).toContain("-base\n+unstaged")
        const working = yield* vcs.diff("working")
        expect(working.map((row) => row.file)).toEqual(["file.txt", "staged.txt", "untracked.txt"])
        expect(working[0].patch).toContain("-committed\n+unstaged")
      }),
    ),
  )

  it.live("keeps a locally undone commit visible only in committed and working modes", () =>
    withGit((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await fs.writeFile(path.join(directory, "file.txt"), "base\n")
          await commitAll(directory, "initial")
          await $`git checkout -b feature`.cwd(directory).quiet()
          await fs.writeFile(path.join(directory, "file.txt"), "committed\n")
          await commitAll(directory, "feature")
          await fs.writeFile(path.join(directory, "file.txt"), "base\n")
        })
        const vcs = yield* Vcs.Service
        expect(yield* vcs.diff("branch")).toEqual([])
        expect((yield* vcs.diff("committed"))[0].patch).toContain("-base\n+committed")
        expect((yield* vcs.diff("working"))[0].patch).toContain("-committed\n+base")
      }),
    ),
  )

  it.live("shows local WIP on the default branch", () =>
    withGit((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await fs.writeFile(path.join(directory, "file.txt"), "base\n")
          await commitAll(directory, "initial")
          await fs.writeFile(path.join(directory, "file.txt"), "dirty\n")
        })
        const vcs = yield* Vcs.Service
        expect(yield* vcs.base()).toEqual({ name: "main", ref: "refs/heads/main", source: "default" })
        expect(yield* vcs.diff("branch")).toEqual(yield* vcs.diff("working"))
        expect(yield* vcs.diff("committed")).toEqual([])
      }),
    ),
  )

  it.live("scopes committed diffs to nested paths and retains binary, rename, and deletion metadata", () =>
    withGit(
      (directory) =>
        Effect.gen(function* () {
          yield* Effect.promise(async () => {
            await fs.writeFile(path.join(directory, "outside.txt"), "base\n")
            await fs.writeFile(path.join(directory, "nested/old.txt"), "rename me\n")
            await fs.writeFile(path.join(directory, "nested/gone.txt"), "delete me\n")
            await fs.writeFile(path.join(directory, "nested/image.png"), Buffer.from([137, 80, 78, 71, 0, 1]))
            await commitAll(directory, "initial")
            await $`git checkout -b feature`.cwd(directory).quiet()
            await fs.writeFile(path.join(directory, "outside.txt"), "changed\n")
            await fs.rename(path.join(directory, "nested/old.txt"), path.join(directory, "nested/new.txt"))
            await fs.rm(path.join(directory, "nested/gone.txt"))
            await fs.writeFile(path.join(directory, "nested/image.png"), Buffer.from([137, 80, 78, 71, 0, 2]))
            await commitAll(directory, "feature")
          })
          const vcs = yield* Vcs.Service
          const committed = yield* vcs.diff("committed")
          expect(committed.map((row) => ({ file: row.file, status: row.status }))).toEqual([
            { file: "nested/gone.txt", status: "deleted" },
            { file: "nested/image.png", status: "modified" },
            { file: "nested/new.txt", status: "added" },
            { file: "nested/old.txt", status: "deleted" },
          ])
          expect(committed[0].patch).toContain("-delete me")
          expect(committed[1]).toMatchObject({ additions: 0, deletions: 0 })
          expect(committed[1].patch).toContain("Binary files")
          expect(committed[2].patch).toContain("+rename me")
          yield* Effect.promise(async () => {
            await fs.rm(path.join(directory, "nested/image.png"))
            await fs.writeFile(path.join(directory, "nested/new.txt"), "dirty\n")
            await fs.writeFile(path.join(directory, "nested/gone.txt"), "untracked resurrection\n")
            await $`git add nested/new.txt`.cwd(directory).quiet()
          })
          expect(yield* vcs.diff("committed")).toEqual(committed)
        }),
      { scope: "nested" },
    ),
  )

  it.live("uses the configured non-default review base without treating upstream as a parent", () =>
    withGit((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await fs.writeFile(path.join(directory, "file.txt"), "base\n")
          await commitAll(directory, "initial")
          await $`git checkout -b release`.cwd(directory).quiet()
          await fs.writeFile(path.join(directory, "release.txt"), "release\n")
          await commitAll(directory, "release")
          await $`git checkout -b feature`.cwd(directory).quiet()
          await fs.writeFile(path.join(directory, "feature.txt"), "feature\n")
          await commitAll(directory, "feature")
          await $`git branch --set-upstream-to=release feature`.cwd(directory).quiet()
        })
        const vcs = yield* Vcs.Service
        expect((yield* vcs.base())?.name).toBe("main")
        yield* Effect.promise(() => $`git config branch.feature.gh-merge-base release`.cwd(directory).quiet())
        const base = yield* vcs.base()
        expect(base).toEqual({ name: "release", ref: "refs/heads/release", source: "configured" })
        expect((yield* vcs.diff("committed", { base: base?.ref })).map((row) => row.file)).toEqual(["feature.txt"])
        expect((yield* vcs.diff("committed")).map((row) => row.file)).toEqual(["feature.txt", "release.txt"])
      }),
    ),
  )

  it.live("reports missing explicit bases and missing default bases without calling them clean", () =>
    withGit((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await fs.writeFile(path.join(directory, "file.txt"), "base\n")
          await commitAll(directory, "initial")
          await $`git branch -m feature`.cwd(directory).quiet()
        })
        const vcs = yield* Vcs.Service
        expect(yield* vcs.base()).toBeNull()
        expect(yield* vcs.diff("committed").pipe(Effect.flip)).toMatchObject({ _tag: "Vcs.DiffError" })
        expect(yield* vcs.diff("branch").pipe(Effect.flip)).toMatchObject({
          _tag: "Vcs.DiffError",
          message: "No review base available",
        })
        expect(yield* vcs.diff("branch", { base: "missing" }).pipe(Effect.flip)).toMatchObject({
          _tag: "Vcs.DiffError",
        })
        expect(yield* vcs.diff("working", { base: "missing" })).toEqual([])
      }),
    ),
  )

  it.live("resolves a configured remote-only base without borrowing another fork's branch", () =>
    withGit((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await fs.writeFile(path.join(directory, "file.txt"), "base\n")
          await commitAll(directory, "initial")
          await $`git remote add origin https://github.com/team/project.git`.cwd(directory).quiet()
          await $`git remote add other https://github.com/other/project.git`.cwd(directory).quiet()
          await $`git update-ref refs/remotes/other/release HEAD`.cwd(directory).quiet()
          await fs.writeFile(path.join(directory, "release.txt"), "release parent\n")
          await $`git checkout -b feature`.cwd(directory).quiet()
          await commitAll(directory, "release parent")
          await $`git update-ref refs/remotes/origin/release HEAD`.cwd(directory).quiet()
          await fs.writeFile(path.join(directory, "feature.txt"), "feature\n")
          await commitAll(directory, "feature")
          await $`git config branch.feature.gh-merge-base release`.cwd(directory).quiet()
        })
        const vcs = yield* Vcs.Service
        const base = yield* vcs.base()
        expect(base).toEqual({ name: "release", ref: "refs/remotes/origin/release", source: "configured" })
        expect((yield* vcs.diff("committed", { base: base?.ref })).map((row) => row.file)).toEqual(["feature.txt"])
        expect((yield* vcs.diff("committed")).map((row) => row.file)).toEqual(["feature.txt", "release.txt"])

        yield* Effect.promise(() =>
          $`git config branch.feature.gh-merge-base refs/remotes/other/release`.cwd(directory).quiet(),
        )
        expect(yield* vcs.base()).toEqual({
          name: "refs/remotes/other/release",
          ref: "refs/remotes/other/release",
          source: "configured",
        })
        yield* Effect.promise(async () => {
          await $`git config branch.feature.gh-merge-base release`.cwd(directory).quiet()
          await $`git update-ref -d refs/remotes/origin/release`.cwd(directory).quiet()
        })
        expect(yield* vcs.base()).toEqual({ name: "main", ref: "refs/heads/main", source: "default" })

        yield* Effect.promise(async () => {
          await $`git update-ref refs/remotes/origin/release HEAD`.cwd(directory).quiet()
          await $`git remote rename origin alpha`.cwd(directory).quiet()
          await $`git remote rename other beta`.cwd(directory).quiet()
        })
        expect(yield* vcs.base()).toEqual({ name: "main", ref: "refs/heads/main", source: "default" })
      }),
    ),
  )

  for (const scenario of [
    { name: "failed", base: () => Effect.fail(new Error("provider failed")) },
    {
      name: "invalid",
      base: () =>
        Effect.succeed({
          name: "release",
          ref: "refs/heads/release",
          source: "pull-request" as const,
          pullRequest: { number: -1, url: "https://github.com/team/project/pull/1" },
        }),
    },
  ]) {
    it.live(`reports ${scenario.name} base metadata as unavailable rather than absent`, () =>
      withTmp((directory) =>
        Effect.gen(function* () {
          const vcs = yield* Vcs.Service
          yield* vcs.transform((draft) => {
            draft.add(provider({ base: scenario.base }))
            draft.default.set("custom")
          })
          expect(yield* vcs.base().pipe(Effect.flip)).toMatchObject({ _tag: "Vcs.DiffError" })
        }).pipe(provide(directory)),
      ),
    )
  }

  it.live("reports provider failures and validates optional base metadata", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const vcs = yield* Vcs.Service
        yield* vcs.transform((draft) => {
          draft.add(
            provider({
              base: () => Effect.succeed({ name: "release", ref: "refs/heads/release", source: "configured" }),
              diff: () => Effect.fail(new Error("failed")),
            }),
          )
          draft.default.set("custom")
        })
        expect((yield* vcs.base())?.source).toBe("configured")
        expect(yield* vcs.diff("committed").pipe(Effect.flip)).toMatchObject({ _tag: "Vcs.DiffError" })
      }).pipe(provide(directory)),
    ),
  )

  it.live("lazily prefers an exact-branch, exact-fork PR base with a verified remote ref", () => {
    const pr = {
      number: 42,
      url: "https://github.com/team/project/pull/42",
      state: "OPEN",
      baseRefName: "release",
      headRefName: "feature",
      headRepository: { name: "project" },
      headRepositoryOwner: { login: "contributor" },
    }
    const calls: string[][] = []
    const response = { unavailable: false }
    return withGit(
      (directory) =>
        Effect.gen(function* () {
          yield* Effect.promise(async () => {
            await fs.writeFile(path.join(directory, "file.txt"), "base\n")
            await commitAll(directory, "initial")
            await $`git remote add origin git@github.com:contributor/project.git`.cwd(directory).quiet()
            await $`git remote add upstream https://github.com/team/project.git`.cwd(directory).quiet()
            await $`git update-ref refs/remotes/upstream/release HEAD`.cwd(directory).quiet()
            await $`git checkout -b feature`.cwd(directory).quiet()
            await $`git config branch.feature.gh-merge-base main`.cwd(directory).quiet()
          })
          const vcs = yield* Vcs.Service
          const bus = yield* Bus.Service
          yield* bus.publish(FileSystem.Event.Changed, { file: path.join(directory, ".git/HEAD"), event: "change" })
          yield* vcs.info()
          yield* vcs.status()
          yield* vcs.diff("working")
          yield* vcs.diff("branch")
          yield* vcs.diff("committed")
          expect(calls).toHaveLength(0)
          expect(yield* vcs.base()).toEqual({
            name: "release",
            ref: "refs/remotes/upstream/release",
            source: "pull-request",
            pullRequest: { number: 42, url: pr.url },
          })
          expect(calls).toHaveLength(1)
          expect(calls[0]).toContain("feature")

          // A same-named branch in the wrong remote must never stand in for the PR base.
          yield* Effect.promise(async () => {
            await $`git update-ref -d refs/remotes/upstream/release`.cwd(directory).quiet()
            await $`git update-ref refs/remotes/origin/release HEAD`.cwd(directory).quiet()
          })
          expect(yield* vcs.base()).toEqual({ name: "main", ref: "refs/heads/main", source: "configured" })
          response.unavailable = true
          expect(yield* vcs.base()).toEqual({ name: "main", ref: "refs/heads/main", source: "configured" })
          yield* Effect.promise(() => $`git config --unset branch.feature.gh-merge-base`.cwd(directory).quiet())
          expect(yield* vcs.base()).toEqual({ name: "main", ref: "refs/heads/main", source: "default" })
        }),
      {
        gh: (command, options) =>
          Effect.gen(function* () {
            expect(command._tag).toBe("StandardCommand")
            if (command._tag === "StandardCommand") calls.push([...command.args])
            expect(options?.timeout).toBe("2 seconds")
            if (response.unavailable)
              return yield* new AppProcess.AppProcessError({ command: "gh", cause: new Error("not installed") })
            return {
              command: "gh",
              exitCode: 0,
              stdout: Buffer.from(
                JSON.stringify([
                  { ...pr, headRefName: "other" },
                  { ...pr, headRepositoryOwner: { login: "wrong-fork" } },
                  { ...pr, state: "CLOSED" },
                  pr,
                ]),
              ),
              stderr: Buffer.alloc(0),
              stdoutTruncated: false,
              stderrTruncated: false,
            }
          }),
      },
    )
  })

  it.live("uses the push remote identity and falls back on malformed or failed gh responses", () => {
    const response = { text: "invalid JSON", exitCode: 0 }
    return withGit(
      (directory) =>
        Effect.gen(function* () {
          yield* Effect.promise(async () => {
            await fs.writeFile(path.join(directory, "file.txt"), "base\n")
            await commitAll(directory, "initial")
            await $`git remote add origin https://github.com/team/project.git`.cwd(directory).quiet()
            await $`git remote set-url --push origin ssh://git@github.com/contributor/project.git`
              .cwd(directory)
              .quiet()
            await $`git update-ref refs/remotes/origin/release HEAD`.cwd(directory).quiet()
            await $`git checkout -b feature`.cwd(directory).quiet()
            await $`git config branch.feature.gh-merge-base missing`.cwd(directory).quiet()
          })
          const vcs = yield* Vcs.Service
          expect((yield* vcs.base())?.source).toBe("default")
          response.text = JSON.stringify([
            {
              number: 1,
              url: "https://github.com/team/project/pull/1",
              state: "OPEN",
              baseRefName: "release",
              headRefName: "feature",
              headRepository: { name: "project" },
              headRepositoryOwner: { login: "contributor" },
            },
          ])
          expect(yield* vcs.base()).toMatchObject({
            name: "release",
            ref: "refs/remotes/origin/release",
            source: "pull-request",
          })
          response.exitCode = 1
          expect((yield* vcs.base())?.source).toBe("default")
          yield* Effect.promise(() => $`git checkout --detach`.cwd(directory).quiet())
          expect((yield* vcs.base())?.source).toBe("default")
        }),
      {
        gh: () =>
          Effect.succeed({
            command: "gh",
            exitCode: response.exitCode,
            stdout: Buffer.from(response.text),
            stderr: Buffer.alloc(0),
            stdoutTruncated: false,
            stderrTruncated: false,
          }),
      },
    )
  })
})
