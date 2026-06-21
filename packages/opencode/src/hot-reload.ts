/**
 * Hot Reload service for ZERO.
 *
 * Watches config, skill, and tool directories for changes and
 * automatically invalidates the relevant caches so the running
 * process picks up modifications without a restart.
 *
 * Two modes:
 *  - **Auto-poll** (default): runs a background fiber that polls
 *    directories every 3 seconds for mtime changes.
 *  - **Manual trigger**: call `notify(path)` when an external
 *    watcher (e.g. @parcel/watcher) detects a change.
 */

import { Context, Duration, Effect, Fiber, Layer, Schedule, Scope } from "effect"
import { Config } from "@/config/config"
import { Skill } from "@/skill"
import { ToolRegistry } from "@/tool/registry"
import path from "path"
import fs from "fs/promises"
import { FSUtil } from "@opencode-ai/core/fs-util"

const POLL_INTERVAL = Duration.seconds(3)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChangeSet {
  config: boolean
  skill: boolean
  tool: boolean
  source: boolean
}

export type ChangeKind = "config" | "skill" | "tool" | "source"

// ---------------------------------------------------------------------------
// Mtime snapshot helpers
// ---------------------------------------------------------------------------

interface Snapshot {
  dir: string
  entries: Record<string, number> // filename -> mtime ms
}

async function takeSnapshot(dir: string): Promise<Snapshot | null> {
  try {
    const entries: Record<string, number> = {}
    const names = await fs.readdir(dir)
    for (const name of names) {
      const stat = await fs.stat(path.join(dir, name)).catch(() => null)
      if (stat) entries[name] = stat.mtimeMs
    }
    return { dir, entries }
  } catch {
    return null
  }
}

function diffSnapshots(
  prev: Snapshot,
  curr: Snapshot,
  interested: Set<string>,
): boolean {
  if (prev.dir !== curr.dir) return false
  for (const name of curr.entries) {
    if (!interested.has(name)) continue
    if (prev.entries[name] !== curr.entries[name]) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface Interface {
  /**
   * Start the background polling fiber.
   * Safe to call multiple times — subsequent calls are no-ops if already running.
   */
  readonly start: Effect.Effect<void>

  /**
   * Stop the background polling fiber.
   */
  readonly stop: Effect.Effect<void>

  /** Whether the polling fiber is currently running. */
  readonly isRunning: Effect.Effect<boolean>

  /**
   * Manually notify the service that a file at `filePath` changed.
   * Useful when integrating with an external file watcher.
   */
  readonly notify: (filePath: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/HotReload") {}

// ---------------------------------------------------------------------------
// Pattern helpers
// ---------------------------------------------------------------------------

/** Filenames that should trigger a config reload. */
const CONFIG_INTERESTED = new Set([
  "opencode.json",
  "opencode.jsonc",
  ".opencode",
])

const SKILL_FILE = "SKILL.md"

/** Directory names that contain custom tool files. */
const TOOL_DIRS = new Set(["tool", "tools"])

function classifyChange(filePath: string): ChangeKind {
  const base = path.basename(filePath)
  if (base === SKILL_FILE) return "skill"
  if (CONFIG_INTERESTED.has(base)) return "config"
  const dir = path.basename(path.dirname(filePath))
  if (TOOL_DIRS.has(dir) && /\.(ts|js)$/.test(base)) return "tool"
  // Check if it's under a known source directory
  if (filePath.includes("/packages/core/src/") || filePath.includes("/packages/opencode/src/")) {
    return "source"
  }
  return "config" // conservative default
}

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

export const layer: Layer.Layer<Service, never, Config.Service | Skill.Service | ToolRegistry.Service | FSUtil.Service | Scope.Scope> =
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const config = yield* Config.Service
      const skill = yield* Skill.Service
      const tools = yield* ToolRegistry.Service
      const fsys = yield* FSUtil.Service

      let fiber: Fiber.Fiber<void> | undefined
      let snapshots: Snapshot[] = []

      const refreshSnapshots = Effect.fn("HotReload.refreshSnapshots")(function* () {
        const dirs: string[] = []
        // Config directories
        yield* Effect.gen(function* () {
          const cfgDirs = yield* config.directories()
          dirs.push(...cfgDirs)
        }).pipe(Effect.catchAll(() => Effect.void)) /* service may not be ready */

        // Skill directories
        yield* Effect.gen(function* () {
          const skillDirs = yield* skill.dirs()
          dirs.push(...skillDirs)
        }).pipe(Effect.catchAll(() => Effect.void)) /* service may not be ready */
        // Tool directories (under config dirs)
        for (const d of (yield* config.directories().pipe(Effect.catch(() => Effect.succeed([] as string[]))))) {
          for (const sub of TOOL_DIRS) {
            const toolDir = path.join(d, sub)
            if (yield* fsys.isDir(toolDir)) dirs.push(toolDir)
          }
        }

        // Take snapshots
        const results: Snapshot[] = []
        for (const dir of dirs) {
          const snap = yield* Effect.promise(() => takeSnapshot(dir))
          if (snap) results.push(snap)
        }
        snapshots = results
      })

      const poll = Effect.fn("HotReload.poll")(function* () {
        const changed: ChangeSet = { config: false, skill: false, tool: false, source: false }

        const fresh: Snapshot[] = []
        for (const prev of snapshots) {
          const curr = yield* Effect.promise(() => takeSnapshot(prev.dir))
          if (!curr) continue
          fresh.push(curr)

          if (diffSnapshots(prev, curr, CONFIG_INTERESTED)) changed.config = true
          if (diffSnapshots(prev, curr, new Set([SKILL_FILE]))) changed.skill = true
          // For tool dirs, all files are tool files
          if (TOOL_DIRS.has(path.basename(prev.dir))) {
            for (const name of Object.keys(curr.entries)) {
              if (prev.entries[name] !== curr.entries[name] && /\.(ts|js)$/.test(name)) {
                changed.tool = true
                break
              }
            }
          }
        }
        snapshots = fresh

        // Apply changes
        if (changed.config) {
          yield* Effect.logInfo("hot-reload: config change detected, invalidating")
          yield* config.invalidate()
        }
        if (changed.skill) {
          yield* Effect.logInfo("hot-reload: skill change detected, invalidating")
          yield* skill.invalidate()
        }
        if (changed.tool) {
          yield* Effect.logInfo("hot-reload: tool change detected, invalidating")
          yield* tools.invalidate()
        }
      })

      const start = Effect.fn("HotReload.start")(function* () {
        if (fiber) return // already running
        yield* refreshSnapshots
        fiber = yield* Effect.forkScoped(
          Effect.repeat(poll, Schedule.fixed(POLL_INTERVAL)).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("hot-reload poll error", { cause }),
            ),
            Effect.forever,
          ),
        )
        yield* Effect.logInfo("hot-reload started")
      })

      const stop = Effect.fn("HotReload.stop")(function* () {
        if (!fiber) return
        yield* Fiber.interrupt(fiber)
        fiber = undefined
        yield* Effect.logInfo("hot-reload stopped")
      })

      const isRunning = Effect.sync(() => fiber !== undefined)

      const notify = Effect.fn("HotReload.notify")(function* (filePath: string) {
        const kind = classifyChange(filePath)
        yield* Effect.logInfo("hot-reload: change detected", { file: filePath, kind })

        switch (kind) {
          case "config":
            yield* config.invalidate()
            break
          case "skill":
            yield* skill.invalidate()
            break
          case "tool":
            yield* tools.invalidate()
            break
          case "source":
            yield* Effect.logInfo("hot-reload: source change — full restart recommended")
            break
        }
      })

      // Auto-start
      yield* start

      return Service.of({ start, stop, isRunning, notify })
    }),
  )

export const defaultLayer = layer.pipe(
  Layer.provide(Config.defaultLayer),
  Layer.provide(Skill.defaultLayer),
  Layer.provide(ToolRegistry.defaultLayer),
  Layer.provide(FSUtil.defaultLayer),
)

export * as HotReload from "./hot-reload"
