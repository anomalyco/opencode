import { $ } from "bun"
import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer, Option, Schema, Scope, Stream } from "effect"
import { TestClock } from "effect/testing"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { AppProcess } from "@opencode-ai/util/process"
import { Bus } from "@opencode-ai/core/bus"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { State } from "@opencode-ai/core/state"
import { Vcs } from "@opencode-ai/core/vcs"
import { VcsGitPlugin } from "@opencode-ai/core/plugin/vcs/git"
import type { VcsDefinition, VcsDiffInput } from "@opencode-ai/plugin/effect/vcs"
import { FileSystem } from "@opencode-ai/schema/filesystem"
import { VcsEvent } from "@opencode-ai/schema/vcs-event"
import { locationLayer } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { it, testEffect } from "./lib/effect"
import { host } from "./plugin/host"

const Done = Bus.ephemeral({ type: "test.vcs.done", schema: {} })

const synthetic = testEffect(
  LayerNode.compile(LayerNode.group([Vcs.node, Bus.node, Location.node]), [
    [Location.node, locationLayer({ directory: AbsolutePath.make(import.meta.dir) })],
  ]),
)

const provide = (directory: string, input: { git?: boolean } = {}) =>
  Effect.provide(
    LayerNode.compile(LayerNode.group([Vcs.node, Bus.node, Location.node, AppProcess.node]), [
      [
        Location.node,
        locationLayer(
          { directory: AbsolutePath.make(directory) },
          input.git ? { vcs: { type: "git", store: AbsolutePath.make(path.join(directory, ".git")) } } : {},
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
      Effect.andThen(
        Effect.gen(function* () {
          const vcs = yield* Vcs.Service
          const context = host()
          yield* VcsGitPlugin.Plugin.effect({
            ...context,
            vcs: { ...context.vcs, transform: vcs.transform, reload: vcs.reload },
          })
          return yield* f(directory)
        }).pipe(provide(directory, { git: true })),
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
  synthetic.effect("returns empty results outside version control", () =>
    Effect.gen(function* () {
      const vcs = yield* Vcs.Service
      expect(yield* vcs.info()).toEqual({ branch: {} })
      expect(yield* vcs.branches()).toEqual([])
      expect(yield* vcs.status()).toEqual([])
      expect(yield* vcs.diff("working")).toEqual([])
      expect(yield* vcs.diff("branch")).toEqual([])
    }),
  )

  synthetic.effect("serves scoped providers and restores the fallback after disposal", () =>
    Effect.gen(function* () {
      const vcs = yield* Vcs.Service
      const registration = yield* vcs.transform((draft) => {
        draft.add(provider())
        draft.default.set("custom")
      })

      expect(yield* vcs.info()).toEqual({ branch: { current: "feature", default: "main" } })
      expect(yield* vcs.branches()).toEqual(["feature", "main"])
      expect(yield* vcs.status()).toEqual([{ file: "file.txt", additions: 1, deletions: 0, status: "added" }])
      expect(yield* vcs.diff("working")).toEqual([
        { file: "file.txt", patch: "+hello", additions: 1, deletions: 0, status: "added" },
      ])

      yield* registration.dispose
      expect(yield* vcs.info()).toEqual({ branch: {} })
      expect(yield* vcs.status()).toEqual([])
    }),
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

  synthetic.effect("passes location scope and bounded diff options to providers", () =>
    Effect.gen(function* () {
      const observed: VcsDiffInput[] = []
      const vcs = yield* Vcs.Service
      const location = yield* Location.Service
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

      yield* vcs.diff("branch", { context: 3 })
      expect(observed).toEqual([
        {
          directory: location.directory,
          worktree: location.directory,
          canonical: location.directory,
          mode: "branch",
          context: 3,
          maxOutputBytes: 10_000_000,
        },
      ])
    }),
  )

  synthetic.effect("validates provider results and bounds oversized patches", () =>
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
    }),
  )

  synthetic.effect("preserves provider interruption", () =>
    Effect.gen(function* () {
      const vcs = yield* Vcs.Service
      let interrupt = false
      yield* vcs.transform((draft) => {
        draft.add(
          provider({
            info: () =>
              interrupt ? Effect.interrupt : Effect.succeed({ branch: { current: "feature", default: "main" } }),
            status: () => Effect.never,
          }),
        )
        draft.default.set("custom")
      })

      const fiber = yield* Effect.forkChild(vcs.status())
      yield* Fiber.interrupt(fiber)
      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBeTrue()

      interrupt = true
      const reload = yield* vcs.reload().pipe(Effect.timeout("1 second"), Effect.forkChild({ startImmediately: true }))
      yield* TestClock.adjust("1 second")
      const reloaded = yield* Fiber.await(reload)
      expect(Exit.isFailure(reloaded) && Cause.hasInterruptsOnly(reloaded.cause)).toBeTrue()
    }),
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
        const event = yield* Fiber.join(updated)
        expect((yield* vcs.info()).branch.current).toBe("after-recovery")
        expect(Option.getOrUndefined(event)).toMatchObject({ data: { branch: "after-recovery" } })
      }),
    ),
  )

  it.effect("stops in-flight and queued reloads when its layer closes", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const root = yield* Scope.make()
      yield* Effect.addFinalizer(() =>
        Deferred.succeed(release, undefined).pipe(
          Effect.andThen(State.batch(Scope.close(root, Exit.void), { flush: false })),
          Effect.andThen(TestClock.adjust("500 millis")),
        ),
      )
      const context = yield* Layer.buildWithScope(
        LayerNode.compile(Vcs.node, [
          [Bus.node, Layer.succeed(Bus.Service, bus)],
          [Location.node, locationLayer({ directory: AbsolutePath.make(import.meta.dir) })],
        ]),
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
      yield* TestClock.adjust("500 millis")
      yield* Deferred.await(entered).pipe(Effect.timeout("1 second"), TestClock.withLive)
      branch = "late"
      const second = yield* vcs.reload().pipe(Effect.forkChild({ startImmediately: true }))
      yield* TestClock.adjust("500 millis")
      yield* Effect.yieldNow
      expect(reads).toEqual(["initial", "initial"])
      expect(first.pollUnsafe()).toBeUndefined()
      expect(second.pollUnsafe()).toBeUndefined()
      const snapshot = yield* vcs.info()

      const shutdown = yield* State.batch(Scope.close(root, Exit.void), { flush: false }).pipe(
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

  synthetic.effect("does not roll back branch streams when an older listener finishes late", () =>
    Effect.gen(function* () {
      const vcs = yield* Vcs.Service
      const bus = yield* Bus.Service
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const updates = yield* bus.subscribe([VcsEvent.BranchUpdated, Done]).pipe(
        Stream.takeUntil((event) => event.type === Done.type),
        Stream.runCollect,
        Effect.forkScoped({ startImmediately: true }),
      )
      const unsubscribe = yield* bus.listen((event) =>
        event.type === VcsEvent.BranchUpdated.type &&
        Schema.decodeUnknownSync(VcsEvent.BranchUpdated.data)(event.data).branch === "older"
          ? Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))
          : Effect.void,
      )

      yield* Effect.gen(function* () {
        const older = yield* vcs
          .transform((draft) => {
            draft.add(provider({ info: () => Effect.succeed({ branch: { current: "older" } }) }))
            draft.default.set("custom")
          })
          .pipe(Effect.forkScoped({ startImmediately: true }))
        yield* Deferred.await(entered)
        yield* vcs.transform((draft) =>
          draft.add(provider({ info: () => Effect.succeed({ branch: { current: "newer" } }) })),
        )
        expect(older.pollUnsafe()).toBeUndefined()
        expect((yield* vcs.info()).branch.current).toBe("newer")

        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(older)
        yield* bus.publish(Done, {})
        const events = (yield* Fiber.join(updates)).filter((event) => event.type === VcsEvent.BranchUpdated.type)
        expect(events.length).toBeGreaterThanOrEqual(2)
        expect(events.at(-1)?.data.branch).toBe((yield* vcs.info()).branch.current)
      }).pipe(Effect.ensuring(Deferred.succeed(release, undefined).pipe(Effect.andThen(unsubscribe))))
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
