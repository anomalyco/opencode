import { $ } from "bun"
import { afterEach, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { ConfigProvider, Effect, Layer, ManagedRuntime } from "effect"
import { tmpdir } from "../fixture/fixture"
import { FileWatcher, FileWatcherService } from "../../src/file/watcher"
import { InstanceContext } from "../../src/effect/instances"
import { Instance } from "../../src/project/instance"
import { GlobalBus } from "../../src/bus/global"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const configLayer = ConfigProvider.layer(
  ConfigProvider.fromUnknown({
    OPENCODE_EXPERIMENTAL_FILEWATCHER: "true",
    OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: "false",
  }),
)

type WatcherEvent = { file: string; event: "add" | "change" | "unlink" }

/** Run `body` with a live FileWatcherService. Runtime is acquired/released via Effect.scoped. */
function withWatcher<E>(directory: string, body: Effect.Effect<void, E>) {
  return Instance.provide({
    directory,
    fn: () =>
      Effect.gen(function* () {
        const ctx = Layer.sync(InstanceContext, () =>
          InstanceContext.of({ directory: Instance.directory, project: Instance.project }),
        )
        const layer = Layer.fresh(FileWatcherService.layer).pipe(Layer.provide(ctx), Layer.provide(configLayer))
        const rt = yield* Effect.acquireRelease(
          Effect.sync(() => ManagedRuntime.make(layer)),
          (rt) => Effect.promise(() => rt.dispose()),
        )
        yield* Effect.promise(() => rt.runPromise(FileWatcherService.use((s) => s.init())))
        yield* Effect.sleep("100 millis")
        yield* body
      }).pipe(Effect.scoped, Effect.runPromise),
  })
}

/** Effect that listens on GlobalBus for a matching watcher event, runs `trigger`, and resolves when it arrives. */
function nextUpdate(directory: string, check: (evt: WatcherEvent) => boolean, trigger: Effect.Effect<void>) {
  return Effect.callback<WatcherEvent>((resume) => {
    function on(evt: { directory?: string; payload: { type: string; properties: WatcherEvent } }) {
      if (evt.directory !== directory) return
      if (evt.payload.type !== FileWatcher.Event.Updated.type) return
      if (!check(evt.payload.properties)) return
      GlobalBus.off("event", on)
      resume(Effect.succeed(evt.payload.properties))
    }
    GlobalBus.on("event", on)
    Effect.runPromise(trigger)
    return Effect.sync(() => GlobalBus.off("event", on))
  }).pipe(Effect.timeout("5 seconds"))
}

/** Effect that asserts no matching event arrives within `ms`. */
function noUpdate(directory: string, check: (evt: WatcherEvent) => boolean, trigger: Effect.Effect<void>, ms = 500) {
  let seen = false
  function on(evt: { directory?: string; payload: { type: string; properties: WatcherEvent } }) {
    if (evt.directory !== directory) return
    if (evt.payload.type !== FileWatcher.Event.Updated.type) return
    if (!check(evt.payload.properties)) return
    seen = true
  }
  return Effect.acquireUseRelease(
    Effect.sync(() => GlobalBus.on("event", on)),
    () =>
      Effect.gen(function* () {
        yield* trigger
        yield* Effect.sleep(`${ms} millis`)
        expect(seen).toBe(false)
      }),
    () => Effect.sync(() => GlobalBus.off("event", on)),
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(() => Instance.disposeAll())

test("FileWatcherService publishes root create, update, and delete events", async () => {
  await using tmp = await tmpdir({ git: true })
  const file = path.join(tmp.path, "watch.txt")
  const dir = tmp.path

  await withWatcher(
    dir,
    Effect.gen(function* () {
      expect(
        yield* nextUpdate(dir, (e) => e.file === file && e.event === "add", Effect.promise(() => fs.writeFile(file, "a"))),
      ).toEqual({ file, event: "add" })

      expect(
        yield* nextUpdate(dir, (e) => e.file === file && e.event === "change", Effect.promise(() => fs.writeFile(file, "b"))),
      ).toEqual({ file, event: "change" })

      expect(
        yield* nextUpdate(dir, (e) => e.file === file && e.event === "unlink", Effect.promise(() => fs.unlink(file))),
      ).toEqual({ file, event: "unlink" })
    }),
  )
})

test("FileWatcherService watches non-git roots", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "plain.txt")
  const dir = tmp.path

  await withWatcher(
    dir,
    Effect.gen(function* () {
      expect(
        yield* nextUpdate(dir, (e) => e.file === file && e.event === "add", Effect.promise(() => fs.writeFile(file, "plain"))),
      ).toEqual({ file, event: "add" })
    }),
  )
})

test("FileWatcherService cleanup stops publishing events", async () => {
  await using tmp = await tmpdir({ git: true })
  const file = path.join(tmp.path, "after-dispose.txt")

  // Start and immediately stop the watcher (withWatcher disposes on exit)
  await withWatcher(tmp.path, Effect.void)

  // Now write a file — no watcher should be listening
  await Effect.runPromise(
    noUpdate(tmp.path, (e) => e.file === file, Effect.promise(() => fs.writeFile(file, "gone"))),
  )
})

test("FileWatcherService ignores non-HEAD git metadata changes", async () => {
  await using tmp = await tmpdir({ git: true })
  const gitIndex = path.join(tmp.path, ".git", "index")
  const edit = path.join(tmp.path, "tracked.txt")

  await withWatcher(
    tmp.path,
    noUpdate(
      tmp.path,
      (e) => e.file === gitIndex,
      Effect.promise(async () => {
        await fs.writeFile(edit, "a")
        await $`git add .`.cwd(tmp.path).quiet().nothrow()
      }),
    ),
  )
})
