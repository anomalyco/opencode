export * as ConfigEntryObserver from "./entry-observer.js"

import type { EventDomain } from "@opencode/plugin/effect/event"
import type { Entry } from "@opencode/schema/config"
import { FSUtil } from "@opencode/util/fs-util"
import { Effect, PubSub, Stream } from "effect"
import path from "path"
import { Config } from "../../config.js"

/** Refresh flag-dependent tool registrations when a config update changes the flag. */
export const observeFlag = Effect.fnUntraced(function* (
  read: Effect.Effect<boolean>,
  event: EventDomain,
  reload: Effect.Effect<void>,
) {
  const flag = { enabled: yield* read }
  yield* event.subscribe({ types: ["config.updated"] }).pipe(
    Stream.runForEach(() =>
      Effect.gen(function* () {
        const enabled = yield* read
        if (enabled === flag.enabled) return
        flag.enabled = enabled
        yield* reload
      }),
    ),
    Effect.forkScoped({ startImmediately: true }),
  )
  return flag
})

/**
 * Runs `reload` on every `config.updated`. The returned `entries` always reads the current config, so a reload that
 * runs before the event arrives already sees the change.
 */
export const observe = Effect.fnUntraced(function* (
  config: Config.Interface,
  event: EventDomain,
  reload: Effect.Effect<void>,
) {
  yield* event.subscribe({ types: ["config.updated"] }).pipe(
    Stream.runForEach(() => reload),
    Effect.forkScoped({ startImmediately: true }),
  )
  return {
    get entries() {
      return config.snapshot()
    },
  }
})

/**
 * Loads documents from config entries and reloads them when config is updated or a file changes
 * under one of `directories` in a config directory.
 */
export const observeSources = Effect.fnUntraced(function* <A>(input: {
  readonly config: Config.Interface
  readonly event: EventDomain
  readonly directories: readonly string[]
  readonly load: () => Effect.Effect<A[]>
  readonly reload: Effect.Effect<void>
}) {
  const config = input.config
  const loaded = { documents: [] as A[] }
  const reload = input.load().pipe(
    Effect.tap((documents) => Effect.sync(() => (loaded.documents = documents))),
    Effect.andThen(input.reload),
  )
  // One trigger feed serializes reloads and shares one debounce window;
  // subscribing before the initial scan means updates racing the scan still
  // trigger a rebuild. Each source is subscribed eagerly on its own fiber
  // (Stream.merge and Stream.debounce both open upstream a fiber hop later)
  // so no update slips through while the debounce starts its pull.
  const changes = yield* PubSub.sliding<void>(1)
  const notify = () => PubSub.publish(changes, undefined)
  yield* config.changes().pipe(
    Stream.filterEffect((update) =>
      Effect.map(config.entries(), (entries) => isDirectorySource(entries, update.path, input.directories)),
    ),
    Stream.runForEach(notify),
    Effect.forkScoped({ startImmediately: true }),
  )
  yield* input.event
    .subscribe({ types: ["config.updated"] })
    .pipe(Stream.runForEach(notify), Effect.forkScoped({ startImmediately: true }))
  const updates = yield* PubSub.subscribe(changes)
  yield* Stream.fromSubscription(updates).pipe(
    Stream.debounce("100 millis"),
    Stream.runForEach(() => reload),
    Effect.forkScoped({ startImmediately: true }),
  )
  loaded.documents = yield* input.load()
  return loaded
})

// Matches anything at or under <root>/<name> for a config directory. No file-suffix
// check: directory-level events such as renames carry no per-file paths.
export function isDirectorySource(entries: readonly Entry[], file: string, names: readonly string[]) {
  return entries.some(
    (entry) => entry.type === "directory" && names.some((name) => FSUtil.contains(path.join(entry.path, name), file)),
  )
}
