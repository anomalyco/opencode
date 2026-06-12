/**
 * @spec-handoff
 * @interface SkillV2.Service — hot-reload via Watcher.Event.Updated subscription
 *   The implementation in `src/skill.ts` must:
 *   1. During layer init: subscribe to EventV2.Service.subscribe(Watcher.Event.Updated)
 *      in a scoped fiber. When an event's `file` path starts with a registered
 *      DirectorySource.path (using path prefix, not substring match), delete the
 *      cache entry for that source so the next list() triggers a fresh load.
 *   2. On first load of a DirectorySource: call Watcher.Service.watch(source.path)
 *      exactly once per source path (deduplicated via a Set; not called on cache hits
 *      or after invalidation reloads).
 *
 * @interface Watcher.Interface (extended in src/filesystem/watcher.ts)
 *   readonly watch: (directory: string) => Effect.Effect<void>
 *   Required on the Interface type — SkillV2 obtains Watcher.Service via
 *   Effect.serviceOption; when absent a no-op fallback `{ watch: () => Effect.void }`
 *   is used so list() still returns results without crashing.
 *
 * @behavior
 *   - Two consecutive list() calls with no intervening events invoke load only once
 *     (stale disk content is returned on the second call).
 *   - Watcher.Event.Updated { file, event: "change" } where `file` is inside a
 *     registered DirectorySource path invalidates that source's cache entry.
 *   - UrlSource cache entries are NOT invalidated by filesystem watcher events.
 *   - A watcher event for a path outside all registered DirectorySource paths leaves
 *     all cache entries intact.
 *   - Two rapid consecutive events for the same source both invalidate; list() returns
 *     the latest disk state after both are processed.
 *   - Watcher.Service.watch() is called with DirectorySource.path exactly once per
 *     source, on first load (not on cache hits).
 *
 * @edge-cases
 *   - Path prefix collision: /a/skills-extra MUST NOT invalidate a source at /a/skills
 *     (the match must use path.relative to confirm containment, not startsWith on string)
 *   - If Watcher.Service.watch is absent, SkillV2 must not crash during init or list()
 *   - UrlSource invalidation is driven by SkillDiscovery.pull, not the filesystem watcher
 *
 * @see packages/core/src/skill.ts (cache Map, load fn, list fn)
 * @see packages/core/src/filesystem/watcher.ts (Watcher.Event.Updated definition)
 * @see packages/core/src/event.ts (EventV2.Interface — subscribe returns Stream)
 */

import path from "path"
import fs from "fs/promises"
import { describe, expect } from "bun:test"
import { Effect, Layer, PubSub, Stream } from "effect"
import { EventV2 } from "@opencode-ai/core/event"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Watcher } from "@opencode-ai/core/filesystem/watcher"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SkillV2 } from "@opencode-ai/core/skill"
import { SkillDiscovery } from "@opencode-ai/core/skill/discovery"
import { tmpdir } from "./fixture/tmpdir"
import { it } from "./lib/effect"

// ---------------------------------------------------------------------------
// Stub SkillDiscovery — URL pulls return empty unless overridden per-test
// ---------------------------------------------------------------------------
const discoveryStub = Layer.succeed(
  SkillDiscovery.Service,
  SkillDiscovery.Service.of({ pull: () => Effect.succeed([]) }),
)

// ---------------------------------------------------------------------------
// In-memory EventV2: publish() routes to subscribe() via PubSub
// ---------------------------------------------------------------------------
const makeEventMock = Effect.gen(function* () {
  const hub = yield* PubSub.unbounded<EventV2.Payload>()

  const service = EventV2.Service.of({
    publish: (definition, data) =>
      Effect.gen(function* () {
        const event = {
          id: EventV2.ID.create(),
          type: definition.type,
          data,
        } as EventV2.Payload<typeof definition>
        yield* PubSub.publish(hub, event as unknown as EventV2.Payload)
        return event
      }),

    subscribe: (definition) =>
      Stream.fromPubSub(hub).pipe(
        Stream.filter((e) => e.type === definition.type),
        Stream.map((e) => e as EventV2.Payload<typeof definition>),
      ),

    all: () => Stream.empty,
    aggregateEvents: () => Stream.empty,
    sync: () => Effect.succeed(Effect.void),
    listen: () => Effect.succeed(Effect.void),
    beforeCommit: () => Effect.void,
    project: () => Effect.void,
    replay: () => Effect.void,
    replayAll: () => Effect.succeed(undefined),
    remove: () => Effect.void,
    claim: () => Effect.void,
  })

  return { service, layer: Layer.succeed(EventV2.Service, service) }
})

// ---------------------------------------------------------------------------
// Watcher spy: records every directory passed to watch()
// ---------------------------------------------------------------------------
const makeWatcherSpy = Effect.sync(() => {
  const calls: string[] = []
  const service = Watcher.Service.of({
    watch: (dir) =>
      Effect.sync(() => {
        calls.push(dir)
      }),
  })
  return { calls, layer: Layer.succeed(Watcher.Service, service) }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Write a SKILL.md with an explicit frontmatter name and arbitrary body. */
const writeSkill = (directory: string, name: string, body: string) =>
  Effect.promise(() =>
    fs
      .mkdir(directory, { recursive: true })
      .then(() => fs.writeFile(path.join(directory, "SKILL.md"), `---\nname: ${name}\n---\n${body}`)),
  )

/** Build the layer under test — each test gets a fresh SkillV2 instance. */
function buildLayer(eventLayer: Layer.Layer<EventV2.Service>, watcherLayer: Layer.Layer<Watcher.Service>) {
  return SkillV2.layer.pipe(
    Layer.provide(discoveryStub),
    Layer.provide(FSUtil.defaultLayer),
    Layer.provide(eventLayer),
    Layer.provide(watcherLayer),
  )
}

/** Register a single DirectorySource and return the SkillV2.Service. */
const withDirectorySource = (skillDir: string) =>
  Effect.gen(function* () {
    const skill = yield* SkillV2.Service
    const register = yield* skill.transform()
    yield* register((ed) => ed.source({ type: "directory" as const, path: AbsolutePath.make(skillDir) }))
    return skill
  })

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("SkillV2 hot-reload", () => {
  it.live(
    "T1: cache hit — second list() returns stale content; watch() was registered for the directory",
    () =>
      Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (t) => Effect.promise(() => t[Symbol.asyncDispose]()),
      ).pipe(
        Effect.flatMap((tmp) =>
          Effect.gen(function* () {
            const skillDir = path.join(tmp.path, "skills")
            yield* writeSkill(skillDir, "myskill", "body v1")

            const ev = yield* makeEventMock
            const w = yield* makeWatcherSpy
            const layer = buildLayer(ev.layer, w.layer)

            yield* Effect.gen(function* () {
              const skill = yield* withDirectorySource(skillDir)

              const first = yield* skill.list()
              expect(first[0]?.content.trim()).toBe("body v1")

              // Mutate file on disk — no watcher event published
              yield* Effect.promise(() =>
                fs.writeFile(path.join(skillDir, "SKILL.md"), `---\nname: myskill\n---\nbody v2`),
              )

              const second = yield* skill.list()
              // Cache hit: stale content expected
              expect(second[0]?.content.trim()).toBe("body v1")

              // RED: watch() must have been called for the directory when list() ran
              expect(w.calls).toContain(skillDir)
            }).pipe(Effect.provide(layer))
          }),
        ),
      ),
  )

  it.live(
    "T2: DirectorySource cache is invalidated when Watcher.Event.Updated fires for a file in that directory",
    () =>
      Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (t) => Effect.promise(() => t[Symbol.asyncDispose]()),
      ).pipe(
        Effect.flatMap((tmp) =>
          Effect.gen(function* () {
            const skillDir = path.join(tmp.path, "skills")
            yield* writeSkill(skillDir, "myskill", "body v1")

            const ev = yield* makeEventMock
            const w = yield* makeWatcherSpy
            const layer = buildLayer(ev.layer, w.layer)

            yield* Effect.gen(function* () {
              const skill = yield* withDirectorySource(skillDir)

              const first = yield* skill.list()
              expect(first[0]?.content.trim()).toBe("body v1")

              // Update file on disk
              yield* Effect.promise(() =>
                fs.writeFile(path.join(skillDir, "SKILL.md"), `---\nname: myskill\n---\nbody v2`),
              )

              // Publish watcher event for the changed file
              yield* ev.service.publish(Watcher.Event.Updated, {
                file: path.join(skillDir, "SKILL.md"),
                event: "change",
              })
              // Yield to let the subscription fiber process the invalidation
              yield* Effect.yieldNow
              yield* Effect.yieldNow

              // RED: cache should be invalidated → fresh load → v2
              const second = yield* skill.list()
              expect(second[0]?.content.trim()).toBe("body v2")
            }).pipe(Effect.provide(layer))
          }),
        ),
      ),
  )

  it.live(
    "T3: UrlSource cache is NOT invalidated by watcher events; DirectorySource IS invalidated",
    () =>
      Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (t) => Effect.promise(() => t[Symbol.asyncDispose]()),
      ).pipe(
        Effect.flatMap((tmp) =>
          Effect.gen(function* () {
            const skillDir = path.join(tmp.path, "skills")
            yield* writeSkill(skillDir, "dirskill", "dir v1")

            const urlDir = path.join(tmp.path, "url-root")
            yield* Effect.promise(() =>
              fs
                .mkdir(urlDir, { recursive: true })
                .then(() => fs.writeFile(path.join(urlDir, "SKILL.md"), `---\nname: urlskill\n---\nurl v1`)),
            )

            // Per-test SkillDiscovery that counts pull() invocations
            let urlPulls = 0
            const discovery = Layer.succeed(
              SkillDiscovery.Service,
              SkillDiscovery.Service.of({
                pull: () => {
                  urlPulls++
                  return Effect.succeed([AbsolutePath.make(urlDir)])
                },
              }),
            )

            const ev = yield* makeEventMock
            const w = yield* makeWatcherSpy
            const layer = SkillV2.layer.pipe(
              Layer.provide(discovery),
              Layer.provide(FSUtil.defaultLayer),
              Layer.provide(ev.layer),
              Layer.provide(w.layer),
            )

            yield* Effect.gen(function* () {
              const skill = yield* SkillV2.Service
              const register = yield* skill.transform()
              yield* register((ed) => {
                ed.source({ type: "directory" as const, path: AbsolutePath.make(skillDir) })
                ed.source({ type: "url" as const, url: "https://example.test/skills/" })
              })

              yield* skill.list() // populates both caches; urlPulls === 1

              // Update directory skill on disk only
              yield* Effect.promise(() =>
                fs.writeFile(path.join(skillDir, "SKILL.md"), `---\nname: dirskill\n---\ndir v2`),
              )

              // Publish event that targets only the DirectorySource file
              yield* ev.service.publish(Watcher.Event.Updated, {
                file: path.join(skillDir, "SKILL.md"),
                event: "change",
              })
              yield* Effect.yieldNow
              yield* Effect.yieldNow

              const skills2 = yield* skill.list()

              // RED: DirectorySource must be invalidated → fresh content from disk
              const dirSkill = skills2.find((s) => s.name === "dirskill")
              expect(dirSkill?.content.trim()).toBe("dir v2")

              // UrlSource must NOT be re-pulled (cache preserved)
              expect(urlPulls).toBe(1)
            }).pipe(Effect.provide(layer))
          }),
        ),
      ),
  )

  it.live(
    "T4: watcher events for paths outside all DirectorySource paths leave every cache entry intact",
    () =>
      Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (t) => Effect.promise(() => t[Symbol.asyncDispose]()),
      ).pipe(
        Effect.flatMap((tmp) =>
          Effect.gen(function* () {
            const skillDir = path.join(tmp.path, "skills")
            yield* writeSkill(skillDir, "myskill", "body v1")

            const ev = yield* makeEventMock
            const w = yield* makeWatcherSpy
            const layer = buildLayer(ev.layer, w.layer)

            yield* Effect.gen(function* () {
              const skill = yield* withDirectorySource(skillDir)

              yield* skill.list() // v1 cached

              // Publish event for a completely unrelated path
              yield* ev.service.publish(Watcher.Event.Updated, {
                file: path.join(tmp.path, "unrelated", "other.md"),
                event: "change",
              })
              yield* Effect.yieldNow
              yield* Effect.yieldNow

              // Update file on disk — but no matching event was published
              yield* Effect.promise(() =>
                fs.writeFile(path.join(skillDir, "SKILL.md"), `---\nname: myskill\n---\nbody v2`),
              )

              const second = yield* skill.list()
              // Cache preserved: the unrelated event must not have invalidated this source
              expect(second[0]?.content.trim()).toBe("body v1")

              // RED: watch() must still have been registered for the source directory
              expect(w.calls).toContain(skillDir)
            }).pipe(Effect.provide(layer))
          }),
        ),
      ),
  )

  it.live(
    "T5: rapid successive events both invalidate; list() returns the latest disk version",
    () =>
      Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (t) => Effect.promise(() => t[Symbol.asyncDispose]()),
      ).pipe(
        Effect.flatMap((tmp) =>
          Effect.gen(function* () {
            const skillDir = path.join(tmp.path, "skills")
            yield* writeSkill(skillDir, "myskill", "body v1")

            const ev = yield* makeEventMock
            const w = yield* makeWatcherSpy
            const layer = buildLayer(ev.layer, w.layer)

            yield* Effect.gen(function* () {
              const skill = yield* withDirectorySource(skillDir)

              yield* skill.list() // v1 cached

              // First rapid change + event
              yield* Effect.promise(() =>
                fs.writeFile(path.join(skillDir, "SKILL.md"), `---\nname: myskill\n---\nbody v2`),
              )
              yield* ev.service.publish(Watcher.Event.Updated, {
                file: path.join(skillDir, "SKILL.md"),
                event: "change",
              })

              // Second rapid change + event (before first is fully processed)
              yield* Effect.promise(() =>
                fs.writeFile(path.join(skillDir, "SKILL.md"), `---\nname: myskill\n---\nbody v3`),
              )
              yield* ev.service.publish(Watcher.Event.Updated, {
                file: path.join(skillDir, "SKILL.md"),
                event: "change",
              })

              yield* Effect.yieldNow
              yield* Effect.yieldNow

              // RED: after both invalidations, list() must return the latest disk state
              const latest = yield* skill.list()
              expect(latest[0]?.content.trim()).toBe("body v3")
            }).pipe(Effect.provide(layer))
          }),
        ),
      ),
  )

  it.live(
    "T6: Watcher.Service.watch() is called with DirectorySource.path on first list()",
    () =>
      Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (t) => Effect.promise(() => t[Symbol.asyncDispose]()),
      ).pipe(
        Effect.flatMap((tmp) =>
          Effect.gen(function* () {
            const skillDir = path.join(tmp.path, "skills")
            yield* writeSkill(skillDir, "myskill", "body v1")

            const ev = yield* makeEventMock
            const w = yield* makeWatcherSpy
            const layer = buildLayer(ev.layer, w.layer)

            yield* Effect.gen(function* () {
              const skill = yield* withDirectorySource(skillDir)

              // No watch calls before the first list()
              expect(w.calls).toHaveLength(0)

              yield* skill.list()

              // RED: watch() must be called exactly once for the skill directory
              expect(w.calls).toContain(skillDir)
              expect(w.calls.filter((d) => d === skillDir)).toHaveLength(1)
            }).pipe(Effect.provide(layer))
          }),
        ),
      ),
  )

  it.live(
    "T7: path-prefix sibling /a/skills-extra does NOT invalidate source at /a/skills",
    () =>
      Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (t) => Effect.promise(() => t[Symbol.asyncDispose]()),
      ).pipe(
        Effect.flatMap((tmp) =>
          Effect.gen(function* () {
            const skillDir = path.join(tmp.path, "skills")
            yield* writeSkill(skillDir, "myskill", "body v1")

            // A sibling directory whose name is a prefix-collision with skillDir
            const siblingDir = path.join(tmp.path, "skills-extra")
            yield* writeSkill(siblingDir, "sibling", "sibling v1")

            const ev = yield* makeEventMock
            const w = yield* makeWatcherSpy
            const layer = buildLayer(ev.layer, w.layer)

            yield* Effect.gen(function* () {
              const skill = yield* withDirectorySource(skillDir)

              yield* skill.list() // v1 cached

              // Mutate disk content in skillDir
              yield* Effect.promise(() =>
                fs.writeFile(path.join(skillDir, "SKILL.md"), `---\nname: myskill\n---\nbody v2`),
              )

              // Publish event for the prefix-collision sibling directory, NOT skillDir
              yield* ev.service.publish(Watcher.Event.Updated, {
                file: path.join(siblingDir, "SKILL.md"),
                event: "change",
              })
              yield* Effect.yieldNow
              yield* Effect.yieldNow

              const second = yield* skill.list()
              // Cache must NOT have been invalidated — sibling event must not match /a/skills
              expect(second[0]?.content.trim()).toBe("body v1")
            }).pipe(Effect.provide(layer))
          }),
        ),
      ),
  )

  it.live(
    "T8: list() returns correct results when Watcher.Service is absent from DI",
    () =>
      Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (t) => Effect.promise(() => t[Symbol.asyncDispose]()),
      ).pipe(
        Effect.flatMap((tmp) =>
          Effect.gen(function* () {
            const skillDir = path.join(tmp.path, "skills")
            yield* writeSkill(skillDir, "myskill", "body v1")

            const ev = yield* makeEventMock
            // Build layer WITHOUT providing Watcher.Service at all
            const layer = SkillV2.layer.pipe(
              Layer.provide(discoveryStub),
              Layer.provide(FSUtil.defaultLayer),
              Layer.provide(ev.layer),
            )

            yield* Effect.gen(function* () {
              const skill = yield* withDirectorySource(skillDir)

              // Must not throw during list() even with no Watcher.Service
              const skills = yield* skill.list()
              expect(skills).toHaveLength(1)
              expect(skills[0]?.name).toBe("myskill")
              expect(skills[0]?.content.trim()).toBe("body v1")
            }).pipe(Effect.provide(layer))
          }),
        ),
      ),
  )
})
