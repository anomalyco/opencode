/**
 * @spec-handoff
 * @interface Skill.Service — static scan on init; explicit refresh() via reload-skills tool
 *   Source: packages/opencode/src/skill/index.ts
 *
 * @behavior
 *   - Skills are loaded once at init from disk; all()/get() return a static snapshot
 *   - Built-in "customize-opencode" is always registered first (location "<built-in>")
 *   - Disk SKILL.md with name "customize-opencode" overrides the built-in entry
 *   - Without filesystem watcher: state stays frozen until refresh() is called explicitly
 *
 * @edge-cases
 *   - Disk override of built-in deleted → refresh() re-registers built-in first → restored
 *
 * @see packages/opencode/src/skill/index.ts
 * @see packages/opencode/test/tool/reload-skills.test.ts (refresh() behavior tested there)
 */

import path from "path"
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
import { testEffect } from "./lib/effect"
import { testInstanceStoreLayer, provideInstance, tmpdirScoped } from "./fixture/fixture"

// ---------------------------------------------------------------------------
// Fakes / spies
// ---------------------------------------------------------------------------

/** In-memory EventV2Bridge backed by a PubSub — allows tests to push events. */
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

  return { service, layer: Layer.succeed(EventV2Bridge.Service, service) }
})

/** Minimal Config.Service stub: Config.directories() returns a single scanDir. */
const makeConfigLayer = (scanDir: string) =>
  Layer.succeed(
    Config.Service,
    Config.Service.of({
      directories: () => Effect.succeed([scanDir]),
      get: () => Effect.succeed({ skills: undefined } as any),
      getGlobal: () => Effect.succeed({ skills: undefined } as any),
      getConsoleState: () => Effect.succeed({} as any),
      update: () => Effect.void,
      updateGlobal: () => Effect.succeed({ info: {} as any, changed: false }),
      invalidate: () => Effect.void,
      waitForDependencies: () => Effect.void,
    }),
  )

/** Compose the Skill layer with test doubles for EventV2Bridge. */
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

/** Write a SKILL.md file (Bun creates parent directories automatically). */
const writeSkill = (dir: string, name: string, content: string) =>
  Effect.promise(() =>
    Bun.write(path.join(dir, "SKILL.md"), `---\nname: ${name}\n---\n${content}`),
  )

/** Canonical location for a named skill under a scan root (matches OPENCODE_SKILL_PATTERN). */
const skillSubdir = (scanRoot: string, name: string) => path.join(scanRoot, "skill", name)

// ---------------------------------------------------------------------------
// Runner: needs InstanceStore for per-directory InstanceState + CrossSpawnSpawner for git init
// ---------------------------------------------------------------------------

const it = testEffect(Layer.mergeAll(testInstanceStoreLayer, CrossSpawnSpawner.defaultLayer))

// ---------------------------------------------------------------------------
// B1–B3
// ---------------------------------------------------------------------------

describe("Skill.Service hot-reload", () => {
  // B1 — Static scan baseline (no Watcher)
  it.live(
    "B1: static scan — all() discovers both skills; state unchanged without Watcher",
    () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped({ git: true })
        const scanDir = path.join(dir, ".opencode")

        yield* writeSkill(skillSubdir(scanDir, "skill-a"), "skill-a", "body A")
        yield* writeSkill(skillSubdir(scanDir, "skill-b"), "skill-b", "body B")

        const ev = yield* makeEventBridgeMock
        const skillLayer = buildSkillLayer(scanDir, ev.layer) // no Watcher

        yield* Effect.gen(function* () {
          const skill = yield* Skill.Service
          const all = yield* skill.all()
          const disk = all.filter((s) => s.location !== "<built-in>")

          expect(disk.length).toBe(2)
          expect(disk.find((s) => s.name === "skill-a")).toBeDefined()
          expect(disk.find((s) => s.name === "skill-b")).toBeDefined()

          const a = yield* skill.get("skill-a")
          expect(a?.content.trim()).toBe("body A")
          expect(a?.location).toContain(path.join("skill", "skill-a", "SKILL.md"))

          // Modify on disk without publishing an event — state must stay static
          yield* Effect.promise(() =>
            Bun.write(path.join(skillSubdir(scanDir, "skill-a"), "SKILL.md"), `---\nname: skill-a\n---\nupdated A`),
          )

          const a2 = yield* skill.get("skill-a")
          expect(a2?.content.trim()).toBe("body A") // unchanged
        }).pipe(Effect.provide(skillLayer), provideInstance(dir))
      }),
  )

  // B2 — Built-in skill always present
  it.live(
    "B2: built-in customize-opencode is always returned by all() with location <built-in>",
    () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped({ git: true })
        const scanDir = path.join(dir, ".opencode")
        // No SKILL.md files on disk

        const ev = yield* makeEventBridgeMock
        const skillLayer = buildSkillLayer(scanDir, ev.layer)

        yield* Effect.gen(function* () {
          const skill = yield* Skill.Service
          const all = yield* skill.all()
          const builtIn = all.find((s) => s.name === "customize-opencode")

          expect(builtIn).toBeDefined()
          expect(builtIn?.location).toBe("<built-in>")
        }).pipe(Effect.provide(skillLayer), provideInstance(dir))
      }),
  )

  // B3 — Built-in can be overridden by a disk skill
  it.live(
    "B3: disk SKILL.md named customize-opencode overrides the built-in entry",
    () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped({ git: true })
        const scanDir = path.join(dir, ".opencode")

        yield* writeSkill(skillSubdir(scanDir, "customize-opencode"), "customize-opencode", "disk override content")

        const ev = yield* makeEventBridgeMock
        const skillLayer = buildSkillLayer(scanDir, ev.layer)

        yield* Effect.gen(function* () {
          const skill = yield* Skill.Service
          const entry = yield* skill.get("customize-opencode")

          expect(entry).toBeDefined()
          expect(entry?.location).not.toBe("<built-in>")
          expect(entry?.location).toContain("customize-opencode")
          expect(entry?.content.trim()).toBe("disk override content")
        }).pipe(Effect.provide(skillLayer), provideInstance(dir))
      }),
  )

})
