/**
 * @spec-handoff
 * @interface Skill.Service.refresh(): Effect.Effect<Info[]>
 *   Source: packages/opencode/src/skill/index.ts
 *
 * @behavior
 *   - Re-runs the full skill discovery pass (same logic as the hot-reload fiber)
 *   - Overwrites the internal Ref<State> with the freshly discovered state
 *   - Re-registers the built-in "customize-opencode" skill BEFORE disk scan (same invariant as init)
 *   - Returns the updated Info[] list from the new state
 *   - After refresh(), calls to all() / get() reflect the updated state
 *   - Works when Watcher.Service is absent — no dependency on the file watcher
 *   - Calling refresh() twice without any disk change returns the same list (idempotent)
 *
 * @edge-cases
 *   - New SKILL.md written to disk after init → refresh() returns it
 *   - Existing SKILL.md deleted → refresh() drops it from the list
 *   - SKILL.md content modified → refresh() reflects the new content
 *   - No SKILL.md files on disk → refresh() returns only the built-in
 *   - Built-in "customize-opencode" always present at location "<built-in>"
 *
 * @see packages/opencode/src/skill/index.ts (Skill.Interface, Ref<State>, discoverSkills)
 */

import path from "path"
import fs from "fs/promises"
import { describe, expect } from "bun:test"
import { Effect, Layer, PubSub, Stream } from "effect"
import { EventV2 } from "@opencode-ai/core/event"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Config } from "@/config/config"
import { Discovery } from "@/skill/discovery"
import { EventV2Bridge } from "@/event-v2-bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Skill } from "@/skill"
import { testEffect } from "../lib/effect"
import { testInstanceStoreLayer, provideInstance, tmpdirScoped } from "../fixture/fixture"

// ---------------------------------------------------------------------------
// Shared test doubles
// ---------------------------------------------------------------------------

/** Minimal in-memory EventV2Bridge backed by a PubSub. */
const makeEventBridgeMock = Effect.gen(function* () {
  const hub = yield* PubSub.unbounded<EventV2.Payload>()
  const service = EventV2Bridge.Service.of({
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
  return Layer.succeed(EventV2Bridge.Service, service)
})

/** Minimal Config stub: directories() returns the provided scanDir. */
const makeConfigLayer = (scanDir: string) =>
  Layer.succeed(
    Config.Service,
    Config.Service.of({
      directories: () => Effect.succeed([scanDir]),
      get: () => Effect.succeed({ skills: undefined } as unknown as Config.Info),
      getGlobal: () => Effect.succeed({ skills: undefined } as any),
      getConsoleState: () => Effect.succeed({} as any),
      update: () => Effect.void,
      updateGlobal: () => Effect.succeed({ info: {} as any, changed: false }),
      invalidate: () => Effect.void,
      waitForDependencies: () => Effect.void,
    }),
  )

/**
 * Assemble the Skill layer WITHOUT a Watcher.
 * Watcher.Service is intentionally absent — Effect.serviceOption returns Option.none()
 * inside Skill.layer, so no watch subscriptions are set up. This is the baseline config
 * for testing refresh() in isolation.
 */
const buildSkillLayer = (scanDir: string, eventLayer: Layer.Layer<EventV2Bridge.Service>) =>
  Skill.layer.pipe(
    Layer.provide(
      Layer.succeed(Discovery.Service, Discovery.Service.of({ pull: () => Effect.succeed([]) })),
    ),
    Layer.provide(makeConfigLayer(scanDir)),
    Layer.provide(eventLayer),
    Layer.provide(FSUtil.defaultLayer),
    Layer.provide(Global.layer),
    Layer.provide(RuntimeFlags.layer({ disableExternalSkills: true, disableClaudeCodeSkills: true })),
  )

/** Write a SKILL.md file with frontmatter under `dir/SKILL.md`. */
const writeSkill = (dir: string, name: string, body: string) =>
  Effect.promise(() =>
    Bun.write(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} skill\n---\n${body}`),
  )

/** Canonical subdirectory for a named skill under a scan root (matches OPENCODE_SKILL_PATTERN). */
const skillSubdir = (scanRoot: string, name: string) => path.join(scanRoot, "skill", name)

// ---------------------------------------------------------------------------
// Runner: needs InstanceStore + CrossSpawnSpawner (for git init in tmpdirScoped)
// ---------------------------------------------------------------------------

const it = testEffect(Layer.mergeAll(testInstanceStoreLayer, CrossSpawnSpawner.defaultLayer))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Skill.Service.refresh()", () => {
  // B1 — refresh() after adding a SKILL.md returns the new skill
  it.live(
    "B1: refresh() after adding a SKILL.md to disk includes it in the returned list",
    () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped({ git: true })
        const scanDir = path.join(dir, ".opencode")

        // No SKILL.md files at layer init time
        const evLayer = yield* makeEventBridgeMock
        const skillLayer = buildSkillLayer(scanDir, evLayer)

        yield* Effect.gen(function* () {
          const skill = yield* Skill.Service
          const initial = (yield* skill.all()).filter((s) => s.location !== "<built-in>")
          expect(initial.length).toBe(0)

          // Write a new skill to disk AFTER the service has been initialised
          yield* writeSkill(skillSubdir(scanDir, "added-skill"), "added-skill", "# Added Skill content")

          // refresh() must re-run discovery and return the new skill
          const refreshed = yield* skill.refresh()
          const disk = refreshed.filter((s) => s.location !== "<built-in>")

          expect(disk.length).toBe(1)
          expect(disk[0].name).toBe("added-skill")
          expect(disk[0].description).toBe("added-skill skill")
          expect(disk[0].content.trim()).toBe("# Added Skill content")

          // all() must also reflect the refreshed state
          const afterAll = (yield* skill.all()).filter((s) => s.location !== "<built-in>")
          expect(afterAll.length).toBe(1)
          expect(afterAll[0].name).toBe("added-skill")

          // get() must also resolve the newly added skill
          expect((yield* skill.get("added-skill"))?.name).toBe("added-skill")
        }).pipe(Effect.provide(skillLayer), provideInstance(dir))
      }),
  )

  // B2 — refresh() after deleting a SKILL.md removes it from the list
  it.live(
    "B2: refresh() after deleting a SKILL.md removes it from the returned list",
    () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped({ git: true })
        const scanDir = path.join(dir, ".opencode")

        // Seed one skill before layer init
        yield* writeSkill(skillSubdir(scanDir, "doomed-skill"), "doomed-skill", "# Going away")

        const evLayer = yield* makeEventBridgeMock
        const skillLayer = buildSkillLayer(scanDir, evLayer)

        yield* Effect.gen(function* () {
          const skill = yield* Skill.Service
          const initial = (yield* skill.all()).filter((s) => s.location !== "<built-in>")
          expect(initial.length).toBe(1)
          expect(initial[0].name).toBe("doomed-skill")

          // Delete the skill directory from disk
          yield* Effect.promise(() =>
            fs.rm(skillSubdir(scanDir, "doomed-skill"), { recursive: true, force: true }),
          )

          // refresh() must re-run discovery and drop the deleted skill
          const refreshed = yield* skill.refresh()
          const disk = refreshed.filter((s) => s.location !== "<built-in>")

          expect(disk.length).toBe(0)
          expect(disk.find((s) => s.name === "doomed-skill")).toBeUndefined()

          // get() must also reflect the deletion
          const afterGet = yield* skill.get("doomed-skill")
          expect(afterGet).toBeUndefined()
        }).pipe(Effect.provide(skillLayer), provideInstance(dir))
      }),
  )

  // B3 — refresh() after modifying a SKILL.md updates the content
  it.live(
    "B3: refresh() after modifying a SKILL.md returns the updated content",
    () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped({ git: true })
        const scanDir = path.join(dir, ".opencode")

        yield* writeSkill(skillSubdir(scanDir, "mutable-skill"), "mutable-skill", "# Original content")

        const evLayer = yield* makeEventBridgeMock
        const skillLayer = buildSkillLayer(scanDir, evLayer)

        yield* Effect.gen(function* () {
          const skill = yield* Skill.Service
          const initial = yield* skill.get("mutable-skill")
          expect(initial?.content.trim()).toBe("# Original content")

          // Overwrite SKILL.md with new content
          yield* writeSkill(skillSubdir(scanDir, "mutable-skill"), "mutable-skill", "# Updated content")

          // refresh() must re-read the file and return the new content
          const refreshed = yield* skill.refresh()
          const entry = refreshed.find((s) => s.name === "mutable-skill")

          expect(entry).toBeDefined()
          expect(entry!.content.trim()).toBe("# Updated content")

          // get() must also return the new content
          const afterGet = yield* skill.get("mutable-skill")
          expect(afterGet?.content.trim()).toBe("# Updated content")
        }).pipe(Effect.provide(skillLayer), provideInstance(dir))
      }),
  )

  // B4 — refresh() is idempotent — calling twice without disk changes returns same list
  it.live(
    "B4: refresh() called twice without disk changes returns the same list (idempotent)",
    () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped({ git: true })
        const scanDir = path.join(dir, ".opencode")

        yield* writeSkill(skillSubdir(scanDir, "stable-skill"), "stable-skill", "# Stable")

        const evLayer = yield* makeEventBridgeMock
        const skillLayer = buildSkillLayer(scanDir, evLayer)

        yield* Effect.gen(function* () {
          const skill = yield* Skill.Service

          const first = yield* skill.refresh()
          const second = yield* skill.refresh()

          const firstDisk = first.filter((s) => s.location !== "<built-in>")
          const secondDisk = second.filter((s) => s.location !== "<built-in>")

          // Same count
          expect(firstDisk.length).toBe(1)
          expect(secondDisk.length).toBe(1)

          // Same name, content, and location
          expect(firstDisk[0].name).toBe("stable-skill")
          expect(secondDisk[0].name).toBe("stable-skill")
          expect(firstDisk[0].content).toBe(secondDisk[0].content)
          expect(firstDisk[0].location).toBe(secondDisk[0].location)
        }).pipe(Effect.provide(skillLayer), provideInstance(dir))
      }),
  )

  // B5 — refresh() always preserves the built-in customize-opencode skill
  it.live(
    "B5: refresh() always returns the built-in customize-opencode skill at location <built-in>",
    () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped({ git: true })
        const scanDir = path.join(dir, ".opencode")
        // No disk skills — only built-in should be present

        const evLayer = yield* makeEventBridgeMock
        const skillLayer = buildSkillLayer(scanDir, evLayer)

        yield* Effect.gen(function* () {
          const skill = yield* Skill.Service

          // First refresh — built-in must be present
          const first = yield* skill.refresh()
          const builtIn1 = first.find((s) => s.name === "customize-opencode")
          expect(builtIn1).toBeDefined()
          expect(builtIn1!.location).toBe("<built-in>")

          // Second refresh — built-in must still be present (re-registered before disk scan)
          const second = yield* skill.refresh()
          const builtIn2 = second.find((s) => s.name === "customize-opencode")
          expect(builtIn2).toBeDefined()
          expect(builtIn2!.location).toBe("<built-in>")
        }).pipe(Effect.provide(skillLayer), provideInstance(dir))
      }),
  )

  // B6 — refresh() works when Watcher.Service is absent
  it.live(
    "B6: refresh() succeeds and picks up disk changes when Watcher.Service is absent",
    () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped({ git: true })
        const scanDir = path.join(dir, ".opencode")

        yield* writeSkill(skillSubdir(scanDir, "nowatcher-skill"), "nowatcher-skill", "# Before refresh")

        const evLayer = yield* makeEventBridgeMock
        // buildSkillLayer intentionally omits Watcher.Service
        const skillLayer = buildSkillLayer(scanDir, evLayer)

        yield* Effect.gen(function* () {
          const skill = yield* Skill.Service
          const initial = yield* skill.get("nowatcher-skill")
          expect(initial?.content.trim()).toBe("# Before refresh")

          // Modify on disk (no watcher to observe — refresh() is the only mechanism)
          yield* writeSkill(skillSubdir(scanDir, "nowatcher-skill"), "nowatcher-skill", "# After refresh")

          // refresh() must not require Watcher and must pick up the disk change
          const refreshed = yield* skill.refresh()
          const updated = refreshed.find((s) => s.name === "nowatcher-skill")

          expect(updated).toBeDefined()
          expect(updated!.content.trim()).toBe("# After refresh")
        }).pipe(Effect.provide(skillLayer), provideInstance(dir))
      }),
  )
})
