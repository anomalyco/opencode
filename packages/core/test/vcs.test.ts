import { $ } from "bun"
import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer, Option, Schema, Scope, Stream } from "effect"
import { TestClock } from "effect/testing"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { AppProcess } from "@opencode-ai/util/process"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Git } from "@opencode-ai/core/git"
import { Bus } from "@opencode-ai/core/bus"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { State } from "@opencode-ai/core/state"
import { Vcs } from "@opencode-ai/core/vcs"
import { VcsGitPlugin } from "@opencode-ai/core/plugin/vcs/git"
import type { VcsDefinition, VcsDiffInput } from "@opencode-ai/plugin/effect/vcs"
import { FileSystem } from "@opencode-ai/schema/filesystem"
import { VcsEvent } from "@opencode-ai/schema/vcs-event"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { it, testEffect } from "./lib/effect"
import { host } from "./plugin/host"

const Done = Bus.ephemeral({ type: "test.vcs.done", schema: {} })
const here = Location.node.replace(
  Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(import.meta.dir) }))),
)
const synthetic = testEffect(LayerNode.compile(LayerNode.group([Vcs.node, Bus.node]), { replacements: [here] }))

const provide = (directory: string, input: { git?: boolean; worktree?: string } = {}) =>
  Effect.provide(
    LayerNode.compile(LayerNode.group([Vcs.node, Bus.node, Location.node, AppProcess.node, FSUtil.node, Git.node]), {
      replacements: [
        Location.node.replace(
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
        ),
      ],
    }),
  )

const withTmp = <A, E, R>(f: (directory: string) => Effect.Effect<A, E, R>) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(Effect.flatMap((tmp) => f(tmp.path)))

const withGit = <A, E, R>(f: (directory: string) => Effect.Effect<A, E, R>, input: { scope?: string } = {}) =>
  withTmp((directory) =>
    Effect.promise(async () => {
      await initRepo(directory)
      if (input.scope) await fs.mkdir(path.join(directory, input.scope), { recursive: true })
    }).pipe(
      Effect.andThen(
        Effect.gen(function* () {
          const vcs = yield* Vcs.Service
          const context = host()
          yield* VcsGitPlugin.Plugin.effect({
            ...context,
            vcs: { ...context.vcs, transform: vcs.transform, reload: vcs.reload },
          })
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

  synthetic.effect("reads batched providers without refreshing intermediate selections", () =>
    Effect.gen(function* () {
      const vcs = yield* Vcs.Service
      const reads: string[] = []
      yield* State.batch(
        Effect.gen(function* () {
          yield* vcs.transform((draft) => {
            draft.add(
              provider({
                info: () =>
                  Effect.sync(() => {
                    reads.push("intermediate")
                    return { branch: { current: "intermediate" } }
                  }),
              }),
            )
            draft.default.set("custom")
          })
          expect((yield* vcs.status())[0]?.file).toBe("file.txt")
          expect(yield* vcs.info()).toEqual({ branch: {} })
          yield* vcs.transform((draft) =>
            draft.add(
              provider({
                info: () =>
                  Effect.sync(() => {
                    reads.push("final")
                    return { branch: { current: "final" } }
                  }),
              }),
            ),
          )
        }),
      )
      expect(reads).toEqual(["final"])
      expect(yield* vcs.info()).toEqual({ branch: { current: "final" } })
    }),
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
        let interrupt = false
        yield* vcs.transform((draft) => {
          draft.add(
            provider({
              info: () => (interrupt ? Effect.interrupt : Effect.succeed({ branch: { current: "feature" } })),
              status: () => Effect.never,
              diff: () => Effect.never,
              base: () => Effect.never,
            }),
          )
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

        interrupt = true
        const refreshed = yield* vcs.reload().pipe(Effect.exit)
        expect(Exit.isFailure(refreshed) && Cause.hasInterruptsOnly(refreshed.cause)).toBeTrue()
      }).pipe(provide(directory)),
    ),
  )

  it.effect("stops in-flight and queued VCS reloads when its layer closes", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const root = yield* Scope.make()
      yield* Effect.addFinalizer(() =>
        Deferred.succeed(release, undefined).pipe(Effect.andThen(State.shutdown(Scope.close(root, Exit.void)))),
      )
      const context = yield* Layer.buildWithScope(
        LayerNode.compile(Vcs.node, { replacements: [Bus.node.replace(Layer.succeed(Bus.Service, bus)), here] }),
        root,
      )
      const vcs = Context.get(context, Vcs.Service)
      const reads: string[] = []
      const observed: (string | undefined)[] = []
      yield* Effect.acquireRelease(
        bus.listen((event) =>
          Effect.sync(() => {
            if (event.type !== VcsEvent.BranchUpdated.type) return
            observed.push(Schema.decodeUnknownSync(VcsEvent.BranchUpdated.data)(event.data).branch)
          }),
        ),
        (unsubscribe) => unsubscribe,
      )
      let branch = "initial"
      let block = false
      yield* vcs
        .transform((draft) => {
          draft.add(
            provider({
              info: () =>
                Effect.gen(function* () {
                  const value = branch
                  reads.push(value)
                  if (block) {
                    block = false
                    yield* Deferred.succeed(entered, undefined)
                    yield* Deferred.await(release)
                  }
                  return { branch: { current: value } }
                }),
            }),
          )
          draft.default.set("custom")
        })
        .pipe(Scope.provide(root))
      observed.length = 0

      block = true
      const first = yield* vcs.reload().pipe(Effect.forkChild({ startImmediately: true }))
      yield* Deferred.await(entered)
      branch = "late"
      const second = yield* vcs.reload().pipe(Effect.forkChild({ startImmediately: true }))
      expect(reads).toEqual(["initial", "initial"])
      expect(first.pollUnsafe()).toBeUndefined()
      expect(second.pollUnsafe()).toBeUndefined()
      const snapshot = yield* vcs.info()

      const shutdown = yield* State.shutdown(Scope.close(root, Exit.void)).pipe(
        Effect.forkChild({ startImmediately: true }),
      )
      yield* TestClock.adjust("1 millis")
      expect(shutdown.pollUnsafe()).toBeDefined()
      expect(first.pollUnsafe()).toBeDefined()
      expect(second.pollUnsafe()).toBeDefined()
      expect(yield* Deferred.isDone(release)).toBe(false)
      yield* Fiber.join(shutdown)
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(first)
      yield* Fiber.join(second)
      expect(reads).toEqual(["initial", "initial"])
      expect(observed).toEqual([])
      expect(yield* vcs.info()).toBe(snapshot)
    }).pipe(Effect.provide(LayerNode.compile(Bus.node))),
  )

  it.live("keeps watching HEAD changes after a transform replay failure", () =>
    withGit((directory) =>
      Effect.gen(function* () {
        const vcs = yield* Vcs.Service
        const bus = yield* Bus.Service
        const replayed = yield* Deferred.make<void>()
        const faulty = yield* Scope.make()
        yield* Effect.addFinalizer(() => Scope.close(faulty, Exit.void))
        let branch = "initial"
        yield* vcs.transform((draft) =>
          draft.add(provider({ id: "git", info: () => Effect.sync(() => ({ branch: { current: branch } })) })),
        )
        const failure = new Error("fixture replay failed")
        let replays = 0
        const failed = yield* vcs
          .transform(() => {
            if (++replays === 2) Deferred.doneUnsafe(replayed, Exit.void)
            throw failure
          })
          .pipe(Scope.provide(faulty), Effect.exit)
        expect(Exit.isFailure(failed) && Cause.squash(failed.cause)).toBe(failure)

        yield* bus.publish(FileSystem.Event.Changed, { file: path.join(directory, ".git", "HEAD"), event: "change" })
        yield* Deferred.await(replayed).pipe(Effect.timeout("1 second"))
        yield* Effect.yieldNow
        const status = yield* vcs.status().pipe(Effect.exit)
        expect(Exit.isFailure(status) && Cause.squash(status.cause)).toBe(failure)
        expect((yield* vcs.info()).branch.current).toBe("initial")

        branch = "recovered"
        yield* Scope.close(faulty, Exit.void)
        expect((yield* vcs.info()).branch.current).toBe("recovered")
        const updated = yield* bus
          .subscribe(VcsEvent.BranchUpdated)
          .pipe(Stream.runHead, Effect.timeout("1 second"), Effect.forkScoped({ startImmediately: true }))
        branch = "after-recovery"
        yield* bus.publish(FileSystem.Event.Changed, { file: path.join(directory, ".git", "HEAD"), event: "change" })
        expect(Option.getOrUndefined(yield* Fiber.join(updated))).toMatchObject({ data: { branch: "after-recovery" } })
        expect((yield* vcs.info()).branch.current).toBe("after-recovery")
      }),
    ),
  )

  it.live("serializes filesystem and config refreshes while reading the latest desired provider", () =>
    withGit((directory) =>
      Effect.gen(function* () {
        const vcs = yield* Vcs.Service
        const bus = yield* Bus.Service
        const started = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const accepted = yield* Deferred.make<void>()
        const reads: string[] = []
        yield* vcs.transform((draft) =>
          draft.add(
            provider({
              id: "git",
              info: () =>
                Effect.gen(function* () {
                  reads.push(reads.length === 0 ? "initial" : "filesystem")
                  if (reads.length === 1) return { branch: { current: "initial" } }
                  yield* Deferred.succeed(started, undefined)
                  yield* Deferred.await(release)
                  return { branch: { current: "filesystem" } }
                }),
            }),
          ),
        )
        const updates = yield* bus
          .subscribe(VcsEvent.BranchUpdated)
          .pipe(Stream.take(2), Stream.runLast, Effect.forkScoped({ startImmediately: true }))

        yield* Effect.gen(function* () {
          yield* bus.publish(FileSystem.Event.Changed, { file: path.join(directory, ".git", "HEAD"), event: "change" })
          yield* Deferred.await(started)
          const configured = yield* State.batch(
            Effect.gen(function* () {
              yield* vcs.transform((draft) =>
                draft.add(
                  provider({
                    id: "git",
                    info: () =>
                      Effect.sync(() => {
                        reads.push("config")
                        return { branch: { current: "config" } }
                      }),
                    status: () => Effect.succeed([{ file: "config.txt", additions: 1, deletions: 0, status: "added" }]),
                  }),
                ),
              )
              expect((yield* vcs.status())[0]?.file).toBe("config.txt")
              expect(yield* vcs.info()).toEqual({ branch: { current: "initial" } })
              yield* Deferred.succeed(accepted, undefined)
            }),
          ).pipe(Effect.forkScoped({ startImmediately: true }))
          yield* Deferred.await(accepted)
          expect(reads).toEqual(["initial", "filesystem"])

          yield* Deferred.succeed(release, undefined)
          yield* Fiber.join(configured)
          expect(Option.getOrUndefined(yield* Fiber.join(updates))?.data.branch).toBe("config")
          expect(yield* vcs.info()).toEqual({ branch: { current: "config" } })
          expect(reads).toEqual(["initial", "filesystem", "config"])
        }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)))
      }),
    ),
  )

  synthetic.effect("keeps branch streams current when listeners change the selected provider", () =>
    Effect.gen(function* () {
      const vcs = yield* Vcs.Service
      const bus = yield* Bus.Service
      const scope = yield* Effect.scope
      const updates = yield* bus.subscribe([VcsEvent.BranchUpdated, Done]).pipe(
        Stream.takeUntil((event) => event.type === Done.type),
        Stream.runCollect,
        Effect.forkScoped({ startImmediately: true }),
      )
      const unsubscribe = yield* bus.listen((event) => {
        if (
          event.type !== VcsEvent.BranchUpdated.type ||
          Schema.decodeUnknownSync(VcsEvent.BranchUpdated.data)(event.data).branch !== "feature"
        )
          return Effect.void
        return vcs
          .transform((draft) =>
            draft.add(provider({ info: () => Effect.succeed({ branch: { current: "listener" } }) })),
          )
          .pipe(Scope.provide(scope), Effect.asVoid)
      })
      yield* Effect.gen(function* () {
        yield* vcs.transform((draft) => {
          draft.add(provider())
          draft.default.set("custom")
        })
        yield* bus.publish(Done, {})
        const events = (yield* Fiber.join(updates)).filter((event) => event.type === VcsEvent.BranchUpdated.type)
        expect(yield* vcs.info()).toEqual({ branch: { current: "listener" } })
        expect(events.length).toBeGreaterThanOrEqual(2)
        expect(events.at(-1)?.data.branch).toBe((yield* vcs.info()).branch.current)
      }).pipe(Effect.ensuring(unsubscribe))
    }),
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
          await $`git checkout -q -b feature main`.cwd(directory).quiet()
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
          await $`git checkout -b feature main`.cwd(directory).quiet()
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
          await $`git checkout -b feature main`.cwd(directory).quiet()
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

  it.live("keeps unpushed default-branch commits in the resolved review", () =>
    withGit((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await fs.writeFile(path.join(directory, "file.txt"), "base\n")
          await commitAll(directory, "initial")
          await $`git remote add origin ${directory}`.cwd(directory).quiet()
          await $`git update-ref refs/remotes/origin/main HEAD`.cwd(directory).quiet()
          await $`git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main`.cwd(directory).quiet()
          await fs.writeFile(path.join(directory, "file.txt"), "committed\n")
          await commitAll(directory, "unpushed")
          await fs.writeFile(path.join(directory, "file.txt"), "dirty\n")
        })
        const vcs = yield* Vcs.Service
        const base = yield* vcs.base()
        expect(base).toEqual({ name: "main", ref: "refs/remotes/origin/main", source: "default" })
        expect((yield* vcs.diff("committed", { base: base?.ref }))[0].patch).toContain("-base\n+committed")
        expect((yield* vcs.diff("branch", { base: base?.ref }))[0].patch).toContain("-base\n+dirty")
        expect((yield* vcs.diff("working"))[0].patch).toContain("-committed\n+dirty")
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
            await $`git checkout -b feature main`.cwd(directory).quiet()
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

  it.live("uses an explicit diff base without treating upstream or Git config as a parent", () =>
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
          await $`git config branch.feature.opencode-merge-base refs/heads/release`.cwd(directory).quiet()
        })
        const vcs = yield* Vcs.Service
        expect(yield* vcs.base().pipe(Effect.flip)).toMatchObject({ message: "Choose a review base" })
        expect((yield* vcs.diff("committed", { base: "release" })).map((row) => row.file)).toEqual(["feature.txt"])
        expect((yield* vcs.diff("committed")).map((row) => row.file)).toEqual(["feature.txt", "release.txt"])
        expect((yield* vcs.diff("branch", { base: "release" })).map((row) => row.file)).toEqual(["feature.txt"])
        expect((yield* vcs.diff("branch")).map((row) => row.file)).toEqual(["feature.txt", "release.txt"])
        expect(yield* vcs.base().pipe(Effect.flip)).toMatchObject({ message: "Choose a review base" })
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
        expect(yield* vcs.base().pipe(Effect.flip)).toMatchObject({ message: "Choose a review base" })
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

  it.live("diffs explicit remote-only bases without borrowing another fork's branch", () =>
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
        })
        const vcs = yield* Vcs.Service
        expect((yield* vcs.diff("committed", { base: "refs/remotes/origin/release" })).map((row) => row.file)).toEqual([
          "feature.txt",
        ])
        expect((yield* vcs.diff("committed")).map((row) => row.file)).toEqual(["feature.txt", "release.txt"])
        expect((yield* vcs.diff("committed", { base: "refs/remotes/other/release" })).map((row) => row.file)).toEqual([
          "feature.txt",
          "release.txt",
        ])
        yield* Effect.promise(async () => {
          await $`git update-ref -d refs/remotes/origin/release`.cwd(directory).quiet()
        })
        expect(yield* vcs.diff("committed", { base: "refs/remotes/origin/release" }).pipe(Effect.flip)).toMatchObject({
          _tag: "Vcs.DiffError",
        })
        expect((yield* vcs.diff("committed", { base: "refs/remotes/other/release" })).map((row) => row.file)).toEqual([
          "feature.txt",
          "release.txt",
        ])
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
          source: "invalid" as const,
        }),
    },
  ]) {
    it.live(`reports ${scenario.name} base metadata as unavailable rather than absent`, () =>
      withTmp((directory) =>
        Effect.gen(function* () {
          const vcs = yield* Vcs.Service
          yield* vcs.transform((draft) => {
            // @ts-expect-error Invalid third-party wire metadata must be checked at runtime.
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
              base: () => Effect.succeed({ name: "release", ref: "refs/heads/release", source: "reflog" }),
              diff: () => Effect.fail(new Error("failed")),
            }),
          )
          draft.default.set("custom")
        })
        expect((yield* vcs.base())?.source).toBe("reflog")
        expect(yield* vcs.diff("committed").pipe(Effect.flip)).toMatchObject({ _tag: "Vcs.DiffError" })
      }).pipe(provide(directory)),
    ),
  )

  it.live("reviews every feature commit and local changes against inferred v2, not the unrelated default", () =>
    withGit((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await fs.writeFile(path.join(directory, "base.txt"), "base\n")
          await commitAll(directory, "initial")
          await $`git remote add origin https://example.com/team/repo.git`.cwd(directory).quiet()
          await $`git update-ref refs/remotes/origin/dev HEAD`.cwd(directory).quiet()
          await $`git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/dev`.cwd(directory).quiet()
          await fs.writeFile(path.join(directory, "v2.txt"), "v2 parent\n")
          await commitAll(directory, "v2")
          await $`git update-ref refs/remotes/origin/v2 HEAD`.cwd(directory).quiet()
          await $`git checkout -b feature origin/v2`.cwd(directory).quiet()
          await $`git config branch.feature.opencode-merge-base refs/remotes/origin/dev`.cwd(directory).quiet()
          await fs.writeFile(path.join(directory, "feature.txt"), "feature\n")
          await commitAll(directory, "feature")
          await fs.writeFile(path.join(directory, "second.txt"), "second\n")
          await commitAll(directory, "second")
          await fs.writeFile(path.join(directory, "third.txt"), "third\n")
          await commitAll(directory, "third")
          await fs.writeFile(path.join(directory, "untracked.txt"), "local\n")
        })
        const vcs = yield* Vcs.Service
        const config = yield* Effect.promise(() => fs.readFile(path.join(directory, ".git/config"), "utf8"))
        const base = yield* vcs.base()
        expect(base).toEqual({ name: "v2", ref: "refs/remotes/origin/v2", source: "reflog" })
        expect((yield* vcs.diff("committed", { base: base?.ref })).map((row) => row.file)).toEqual([
          "feature.txt",
          "second.txt",
          "third.txt",
        ])
        expect((yield* vcs.diff("branch", { base: base?.ref })).map((row) => row.file)).toEqual([
          "feature.txt",
          "second.txt",
          "third.txt",
          "untracked.txt",
        ])
        expect((yield* vcs.diff("committed")).map((row) => row.file)).toEqual([
          "feature.txt",
          "second.txt",
          "third.txt",
          "v2.txt",
        ])
        expect(yield* Effect.promise(() => fs.readFile(path.join(directory, ".git/config"), "utf8"))).toBe(config)
        expect(
          yield* Effect.promise(() => Bun.file(path.join(directory, ".git/opencode-review.json")).exists()),
        ).toBeFalse()
        yield* Effect.promise(() => $`git config branch.feature.opencode-merge-base missing`.cwd(directory).quiet())
        expect(yield* vcs.base()).toEqual({ name: "v2", ref: "refs/remotes/origin/v2", source: "reflog" })
        yield* Effect.promise(() => $`git checkout -b uncertain HEAD`.cwd(directory).quiet())
        expect(yield* vcs.base().pipe(Effect.flip)).toMatchObject({ message: "Choose a review base" })
      }),
    ),
  )

  it.live("ignores stale, deleted, renamed, and self-mirroring creation hints", () =>
    withGit((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await fs.writeFile(path.join(directory, "base.txt"), "base\n")
          await commitAll(directory, "initial")
          await $`git branch parent`.cwd(directory).quiet()
          await $`git checkout -b feature parent`.cwd(directory).quiet()
        })
        const vcs = yield* Vcs.Service
        expect((yield* vcs.base())?.source).toBe("reflog")
        yield* Effect.promise(() => $`git branch -m renamed`.cwd(directory).quiet())
        expect(yield* vcs.base().pipe(Effect.flip)).toMatchObject({ message: "Choose a review base" })
        yield* Effect.promise(async () => {
          await $`git checkout -b deleted parent`.cwd(directory).quiet()
          await $`git branch -D parent`.cwd(directory).quiet()
        })
        expect(yield* vcs.base().pipe(Effect.flip)).toMatchObject({ message: "Choose a review base" })
        yield* Effect.promise(async () => {
          await $`git update-ref refs/remotes/origin/mirror HEAD`.cwd(directory).quiet()
          await $`git checkout -b mirror origin/mirror`.cwd(directory).quiet()
        })
        expect(yield* vcs.base().pipe(Effect.flip)).toMatchObject({ message: "Choose a review base" })
        yield* Effect.promise(async () => {
          await $`git checkout -b stale main`.cwd(directory).quiet()
          await $`git checkout --orphan unrelated`.cwd(directory).quiet()
          await $`git commit -m unrelated`.cwd(directory).quiet()
          await $`git branch -f main HEAD`.cwd(directory).quiet()
          await $`git checkout stale`.cwd(directory).quiet()
        })
        expect(yield* vcs.base().pipe(Effect.flip)).toMatchObject({ message: "Choose a review base" })
        yield* Effect.promise(async () => {
          await $`git checkout -b rebased unrelated`.cwd(directory).quiet()
          await $`git reset --soft stale`.cwd(directory).quiet()
        })
        expect(yield* vcs.base().pipe(Effect.flip)).toMatchObject({ message: "Choose a review base" })
      }),
    ),
  )

  it.live("creates detached worktrees without review metadata and requires an explicit base without a named hint", () =>
    withGit((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await fs.writeFile(path.join(directory, "base.txt"), "base\n")
          await commitAll(directory, "initial")
          await $`git remote add origin https://example.com/team/repo.git`.cwd(directory).quiet()
          await $`git update-ref refs/remotes/origin/dev HEAD`.cwd(directory).quiet()
          await $`git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/dev`.cwd(directory).quiet()
          await fs.writeFile(path.join(directory, "v2.txt"), "v2\n")
          await commitAll(directory, "v2")
          await $`git update-ref refs/remotes/origin/v2 HEAD`.cwd(directory).quiet()
        })
        const git = yield* Git.Service
        const repository = yield* git.repo.discover(AbsolutePath.make(directory))
        if (!repository) throw new Error("Expected Git repository")
        const linked = yield* git.worktree.create({
          repository,
          directory: AbsolutePath.make(path.join(directory, "linked")),
          ref: "origin/v2",
        })
        expect(yield* git.history.branch(linked)).toBeUndefined()
        expect(
          yield* Effect.promise(() => Bun.file(path.join(linked.gitDirectory, "opencode-review.json")).exists()),
        ).toBeFalse()
        yield* Effect.gen(function* () {
          const vcs = yield* Vcs.Service
          const context = host()
          yield* VcsGitPlugin.Plugin.effect({
            ...context,
            vcs: { ...context.vcs, transform: vcs.transform, reload: vcs.reload },
          })
          expect(yield* vcs.base().pipe(Effect.flip)).toMatchObject({ message: "Choose a review base" })
          expect(yield* vcs.diff("committed", { base: "origin/v2" })).toEqual([])
          expect((yield* vcs.diff("committed", { base: "origin/dev" })).map((row) => row.file)).toEqual(["v2.txt"])
          yield* Effect.promise(() => $`git checkout -b child`.cwd(linked.worktree).quiet())
          expect(yield* vcs.base().pipe(Effect.flip)).toMatchObject({ message: "Choose a review base" })
          yield* Effect.promise(() => $`git checkout -b named origin/v2`.cwd(linked.worktree).quiet())
          expect(yield* vcs.base()).toEqual({ name: "v2", ref: "refs/remotes/origin/v2", source: "reflog" })
        }).pipe(provide(linked.worktree, { git: true }))
        expect(
          yield* Effect.promise(() => Bun.file(path.join(linked.gitDirectory, "opencode-review.json")).exists()),
        ).toBeFalse()
        const fromHead = yield* git.worktree.create({
          repository,
          directory: AbsolutePath.make(path.join(directory, "from-head")),
        })
        expect(
          yield* Effect.promise(() => Bun.file(path.join(fromHead.gitDirectory, "opencode-review.json")).exists()),
        ).toBeFalse()
        const detached = yield* git.worktree.create({
          repository: fromHead,
          directory: AbsolutePath.make(path.join(directory, "detached-source")),
        })
        expect(
          yield* Effect.promise(() => Bun.file(path.join(detached.gitDirectory, "opencode-review.json")).exists()),
        ).toBeFalse()
      }),
    ),
  )

  it.live("rejects a branch creation anchor removed by rebase", () =>
    withGit((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await fs.writeFile(path.join(directory, "base.txt"), "base\n")
          await commitAll(directory, "initial")
          await $`git checkout -b parent main`.cwd(directory).quiet()
          await fs.writeFile(path.join(directory, "parent.txt"), "parent\n")
          await commitAll(directory, "parent")
          await $`git checkout -b feature parent`.cwd(directory).quiet()
          await fs.writeFile(path.join(directory, "feature.txt"), "feature\n")
          await commitAll(directory, "feature")
        })
        const vcs = yield* Vcs.Service
        expect((yield* vcs.base())?.name).toBe("parent")
        yield* Effect.promise(() => $`git rebase --onto main parent feature`.cwd(directory).quiet())
        expect(yield* vcs.base().pipe(Effect.flip)).toMatchObject({ message: "Choose a review base" })
      }),
    ),
  )

  it.live("does not infer beyond the bounded creation-reflog window", () =>
    withGit((directory) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await fs.writeFile(path.join(directory, "file.txt"), "base\n")
          await commitAll(directory, "initial")
          await $`git checkout -b feature main`.cwd(directory).quiet()
          await fs.writeFile(path.join(directory, "file.txt"), "feature\n")
          await commitAll(directory, "feature")
        })
        const vcs = yield* Vcs.Service
        expect((yield* vcs.base())?.source).toBe("reflog")
        yield* Effect.promise(async () => {
          const before = (await $`git rev-parse main`.cwd(directory).text()).trim()
          const after = (await $`git rev-parse HEAD`.cwd(directory).text()).trim()
          const updates = Array.from(
            { length: 260 },
            (_, index) => `start\nupdate refs/heads/feature ${index % 2 === 0 ? before : after}\nprepare\ncommit\n`,
          ).join("")
          await $`git update-ref -m test --stdin < ${Buffer.from(updates)}`.cwd(directory).quiet()
        })
        expect(yield* vcs.base().pipe(Effect.flip)).toMatchObject({ message: "Choose a review base" })
      }),
    ),
  )
})
