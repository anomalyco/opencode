import { $ } from "bun"
import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Deferred, Effect, Option } from "effect"
import { tmpdir } from "../fixture/fixture"
import { watcherConfigLayer, withServices } from "../fixture/instance"
import { Bus } from "../../src/bus"
import { FileWatcher } from "../../src/file/watcher"
import { Instance } from "../../src/project/instance"

// Native @parcel/watcher bindings aren't reliably available in CI (missing on Linux, flaky on Windows)
const describeWatcher = FileWatcher.hasNativeBinding() && !process.env.CI ? describe : describe.skip

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type WatcherEvent = { file: string; event: "add" | "change" | "unlink" }

/** Run `body` with a live FileWatcher service. */
function withWatcher<E>(directory: string, body: Effect.Effect<void, E>) {
  return withServices(
    directory,
    FileWatcher.layer,
    async (rt) => {
      await rt.runPromise(FileWatcher.Service.use((s) => s.init()))
      await Effect.runPromise(ready(directory))
      await Effect.runPromise(body)
    },
    { provide: [watcherConfigLayer] },
  )
}

function listen(directory: string, check: (evt: WatcherEvent) => boolean, hit: (evt: WatcherEvent) => void) {
  let done = false

  const unsub = Bus.subscribe(FileWatcher.Event.Updated, (evt) => {
    if (done) return
    if (!check(evt.properties)) return
    hit(evt.properties)
  })

  return () => {
    if (done) return
    done = true
    unsub()
  }
}

function wait(directory: string, check: (evt: WatcherEvent) => boolean) {
  return Effect.gen(function* () {
    const deferred = yield* Deferred.make<WatcherEvent>()
    const cleanup = yield* Effect.sync(() => {
      let off = () => {}
      off = listen(directory, check, (evt) => {
        off()
        Deferred.doneUnsafe(deferred, Effect.succeed(evt))
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
        return yield* Deferred.await(deferred).pipe(Effect.timeout("5 seconds"))
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
        expect(yield* Deferred.await(deferred).pipe(Effect.timeoutOption(`${ms} millis`))).toEqual(Option.none())
      }),
    ({ cleanup }) => Effect.sync(cleanup),
  )
}

function ready(directory: string) {
  const file = path.join(directory, `.watcher-${Math.random().toString(36).slice(2)}`)
  const head = path.join(directory, ".git", "HEAD")

  return Effect.gen(function* () {
    yield* nextUpdate(
      directory,
      (evt) => evt.file === file && evt.event === "add",
      Effect.promise(() => fs.writeFile(file, "ready")),
    ).pipe(Effect.ensuring(Effect.promise(() => fs.rm(file, { force: true }).catch(() => undefined))), Effect.asVoid)

    const git = yield* Effect.promise(() =>
      fs
        .stat(head)
        .then(() => true)
        .catch(() => false),
    )
    if (!git) return

    const branch = `watch-${Math.random().toString(36).slice(2)}`
    const hash = yield* Effect.promise(() => $`git rev-parse HEAD`.cwd(directory).quiet().text())
    yield* nextUpdate(
      directory,
      (evt) => evt.file === head && evt.event !== "unlink",
      Effect.promise(async () => {
        await fs.writeFile(path.join(directory, ".git", "refs", "heads", branch), hash.trim() + "\n")
        await fs.writeFile(head, `ref: refs/heads/${branch}\n`)
      }),
    ).pipe(Effect.asVoid)
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describeWatcher("FileWatcher", () => {
  afterEach(async () => {
    await Instance.disposeAll()
  })

  test("publishes root create, update, and delete events", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "watch.txt")
    const dir = tmp.path
    const cases = [
      { event: "add" as const, trigger: Effect.promise(() => fs.writeFile(file, "a")) },
      { event: "change" as const, trigger: Effect.promise(() => fs.writeFile(file, "b")) },
      { event: "unlink" as const, trigger: Effect.promise(() => fs.unlink(file)) },
    ]

    await withWatcher(
      dir,
      Effect.forEach(cases, ({ event, trigger }) =>
        nextUpdate(dir, (evt) => evt.file === file && evt.event === event, trigger).pipe(
          Effect.tap((evt) => Effect.sync(() => expect(evt).toEqual({ file, event }))),
        ),
      ),
    )
  })

  test("watches non-git roots", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "plain.txt")
    const dir = tmp.path

    await withWatcher(
      dir,
      nextUpdate(
        dir,
        (e) => e.file === file && e.event === "add",
        Effect.promise(() => fs.writeFile(file, "plain")),
      ).pipe(Effect.tap((evt) => Effect.sync(() => expect(evt).toEqual({ file, event: "add" })))),
    )
  })

  test("cleanup stops publishing events", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "after-dispose.txt")

    // Start and immediately stop the watcher (withWatcher disposes on exit)
    await withWatcher(tmp.path, Effect.void)

    // Now write a file — no watcher should be listening
    await Instance.provide({
      directory: tmp.path,
      fn: () =>
        Effect.runPromise(
          noUpdate(
            tmp.path,
            (e) => e.file === file,
            Effect.promise(() => fs.writeFile(file, "gone")),
          ),
        ),
    })
  })

  test("ignores .git/index changes", async () => {
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

  test("publishes .git/HEAD events", async () => {
    await using tmp = await tmpdir({ git: true })
    const head = path.join(tmp.path, ".git", "HEAD")
    const branch = `watch-${Math.random().toString(36).slice(2)}`
    await $`git branch ${branch}`.cwd(tmp.path).quiet()

    await withWatcher(
      tmp.path,
      nextUpdate(
        tmp.path,
        (evt) => evt.file === head && evt.event !== "unlink",
        Effect.promise(() => fs.writeFile(head, `ref: refs/heads/${branch}\n`)),
      ).pipe(
        Effect.tap((evt) =>
          Effect.sync(() => {
            expect(evt.file).toBe(head)
            expect(["add", "change"]).toContain(evt.event)
          }),
        ),
      ),
    )
  })
})
