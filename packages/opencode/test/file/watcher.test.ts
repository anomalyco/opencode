import { describe, expect } from "bun:test"
import path from "path"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { ConfigProvider, Deferred, Effect, Layer, Option } from "effect"
import { TestInstance, provideInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { GlobalBus, type GlobalEvent } from "../../src/bus/global"
import { Config } from "@/config/config"
import { FileWatcher } from "../../src/file/watcher"
import { Git } from "../../src/git"

// Native @parcel/watcher bindings aren't reliably available in CI (missing on Linux, flaky on Windows)
const describeWatcher = FileWatcher.hasNativeBinding() && !process.env.CI ? describe : describe.skip

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const watcherConfigLayer = ConfigProvider.layer(
  ConfigProvider.fromUnknown({
    OPENCODE_EXPERIMENTAL_FILEWATCHER: "true",
    OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: "false",
  }),
)

const watcherLayer = FileWatcher.layer.pipe(
  Layer.provide(Config.defaultLayer),
  Layer.provide(Git.defaultLayer),
  Layer.provide(watcherConfigLayer),
)

const it = testEffect(Layer.mergeAll(AppFileSystem.defaultLayer, Git.defaultLayer))

type WatcherEvent = { file: string; event: "add" | "change" | "unlink" }

/** Run `body` with a live FileWatcher service. */
function withWatcher<A, E, R>(directory: string, body: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const watcher = yield* FileWatcher.Service
    yield* watcher.init()
    yield* ready(directory)
    return yield* body
  }).pipe(Effect.provide(watcherLayer), provideInstance(directory), Effect.scoped)
}

function listen(directory: string, check: (evt: WatcherEvent) => boolean, hit: (evt: WatcherEvent) => void) {
  let done = false

  const on = (evt: GlobalEvent) => {
    if (done) return
    if (evt.directory !== directory) return
    if (evt.payload.type !== FileWatcher.Event.Updated.type) return
    if (!check(evt.payload.properties)) return
    hit(evt.payload.properties)
  }

  GlobalBus.on("event", on)

  return () => {
    if (done) return
    done = true
    GlobalBus.off("event", on)
  }
}

function wait(directory: string, check: (evt: WatcherEvent) => boolean) {
  return Effect.gen(function* () {
    const deferred = yield* Deferred.make<WatcherEvent>()
    const cleanup = yield* Effect.sync(() => {
      let off = () => {}
      off = listen(directory, check, (evt) => {
        off()
        Effect.runFork(Deferred.succeed(deferred, evt))
      })
      return off
    })
    return { cleanup, deferred }
  })
}

function nextUpdate<E>(directory: string, check: (evt: WatcherEvent) => boolean, trigger: Effect.Effect<void, E>) {
  return Effect.acquireUseRelease(
    wait(directory, check),
    ({ deferred }) =>
      Effect.gen(function* () {
        yield* trigger
        return yield* Deferred.await(deferred).pipe(
          Effect.timeoutOrElse({
            duration: "5 seconds",
            orElse: () => Effect.fail(new Error("timed out waiting for file watcher update")),
          }),
        )
      }),
    ({ cleanup }) => Effect.sync(cleanup),
  )
}

/** Effect that asserts no matching event arrives within `ms`. */
function noUpdate<E>(
  directory: string,
  check: (evt: WatcherEvent) => boolean,
  trigger: Effect.Effect<void, E>,
  ms = 500,
) {
  return Effect.acquireUseRelease(
    wait(directory, check),
    ({ deferred }) =>
      Effect.gen(function* () {
        yield* trigger
        const result = yield* Deferred.await(deferred).pipe(
          Effect.map((evt) => Option.some(evt)),
          Effect.timeoutOrElse({ duration: `${ms} millis`, orElse: () => Effect.succeed(Option.none()) }),
        )
        expect(result).toEqual(Option.none())
      }),
    ({ cleanup }) => Effect.sync(cleanup),
  )
}

function ready(directory: string) {
  const file = path.join(directory, `.watcher-${Math.random().toString(36).slice(2)}`)
  const head = path.join(directory, ".git", "HEAD")

  return Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const git = yield* Git.Service

    yield* nextUpdate(
      directory,
      (evt) => evt.file === file && evt.event === "add",
      fs.writeFileString(file, "ready"),
    ).pipe(Effect.ensuring(fs.remove(file, { force: true }).pipe(Effect.ignore)), Effect.asVoid)

    if (!(yield* fs.existsSafe(head))) return

    const branch = `watch-${Math.random().toString(36).slice(2)}`
    const hash = (yield* git.run(["rev-parse", "HEAD"], { cwd: directory })).text()
    yield* nextUpdate(
      directory,
      (evt) => evt.file === head && evt.event !== "unlink",
      fs
        .writeFileString(path.join(directory, ".git", "refs", "heads", branch), hash.trim() + "\n")
        .pipe(Effect.andThen(fs.writeFileString(head, `ref: refs/heads/${branch}\n`))),
    ).pipe(Effect.asVoid)
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describeWatcher("FileWatcher", () => {
  it.instance(
    "publishes root create, update, and delete events",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const fs = yield* AppFileSystem.Service
        const file = path.join(test.directory, "watch.txt")
        const cases = [
          { event: "add" as const, trigger: fs.writeFileString(file, "a") },
          { event: "change" as const, trigger: fs.writeFileString(file, "b") },
          { event: "unlink" as const, trigger: fs.remove(file) },
        ]

        yield* withWatcher(
          test.directory,
          Effect.forEach(cases, ({ event, trigger }) =>
            nextUpdate(test.directory, (evt) => evt.file === file && evt.event === event, trigger).pipe(
              Effect.tap((evt) => Effect.sync(() => expect(evt).toEqual({ file, event }))),
            ),
          ),
        )
      }),
    { git: true },
  )

  it.instance("watches non-git roots", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const fs = yield* AppFileSystem.Service
      const file = path.join(test.directory, "plain.txt")

      yield* withWatcher(
        test.directory,
        nextUpdate(test.directory, (e) => e.file === file && e.event === "add", fs.writeFileString(file, "plain")).pipe(
          Effect.tap((evt) => Effect.sync(() => expect(evt).toEqual({ file, event: "add" }))),
        ),
      )
    }),
  )

  it.instance(
    "cleanup stops publishing events",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const fs = yield* AppFileSystem.Service
        const file = path.join(test.directory, "after-dispose.txt")

        // Start and immediately stop the watcher (withWatcher disposes on exit).
        yield* withWatcher(test.directory, Effect.void)

        // Now write a file - no watcher should be listening.
        yield* noUpdate(test.directory, (e) => e.file === file, fs.writeFileString(file, "gone")).pipe(
          provideInstance(test.directory),
        )
      }),
    { git: true },
  )

  it.instance(
    "ignores .git/index changes",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const fs = yield* AppFileSystem.Service
        const git = yield* Git.Service
        const gitIndex = path.join(test.directory, ".git", "index")
        const edit = path.join(test.directory, "tracked.txt")

        yield* withWatcher(
          test.directory,
          noUpdate(
            test.directory,
            (e) => e.file === gitIndex,
            fs.writeFileString(edit, "a").pipe(Effect.andThen(git.run(["add", "."], { cwd: test.directory }))),
          ),
        )
      }),
    { git: true },
  )

  it.instance(
    "publishes .git/HEAD events",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const fs = yield* AppFileSystem.Service
        const git = yield* Git.Service
        const head = path.join(test.directory, ".git", "HEAD")
        const branch = `watch-${Math.random().toString(36).slice(2)}`
        yield* git.run(["branch", branch], { cwd: test.directory })

        yield* withWatcher(
          test.directory,
          nextUpdate(
            test.directory,
            (evt) => evt.file === head && evt.event !== "unlink",
            fs.writeFileString(head, `ref: refs/heads/${branch}\n`),
          ).pipe(
            Effect.tap((evt) =>
              Effect.sync(() => {
                expect(evt.file).toBe(head)
                expect(["add", "change"]).toContain(evt.event)
              }),
            ),
          ),
        )
      }),
    { git: true },
  )
})
