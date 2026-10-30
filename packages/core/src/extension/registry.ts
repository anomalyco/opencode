export * as ExtensionRegistry from "./registry.js"

import path from "path"
import { Context, Effect, Layer, Option } from "effect"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Extension } from "@opencode/schema/extension"
import { Location } from "../location.js"

export interface HistoryEntry {
  readonly id: string
  readonly extensionId: string
  readonly name: string
  readonly version: string
  readonly action: "install" | "update" | "rollback" | "remove" | "toggle"
  readonly timestamp: number
  readonly scope: Extension.Scope
  readonly details?: string
}

export interface Interface {
  readonly list: (scope?: Extension.Scope) => Effect.Effect<Extension.CIR[]>
  readonly get: (id: string) => Effect.Effect<Extension.CIR | undefined>
  readonly register: (cir: Extension.CIR) => Effect.Effect<void>
  readonly toggle: (id: string, enabled: boolean) => Effect.Effect<Extension.CIR | undefined>
  readonly remove: (id: string) => Effect.Effect<boolean>
  readonly checkForUpdates: (id: string) => Effect.Effect<Extension.ExtensionUpdateInfo | undefined>
  readonly rollback: (id: string, targetVersion: string) => Effect.Effect<Extension.RollbackRecord | undefined>
  readonly getHistory: (extensionId?: string) => Effect.Effect<HistoryEntry[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ExtensionRegistry") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const locationOpt = yield* Effect.serviceOption(Location.Service)
    const location = Option.getOrUndefined(locationOpt)

    const getRegistryFile = (scope: Extension.Scope) => {
      if (scope === "project" && location?.project?.directory) {
        return path.join(location.project.directory, ".opencode", "extensions.json")
      }
      return path.join(global.config, "extensions.json")
    }

    const getHistoryFile = (scope: Extension.Scope) => {
      if (scope === "project" && location?.project?.directory) {
        return path.join(location.project.directory, ".opencode", "extension-history.json")
      }
      return path.join(global.config, "extension-history.json")
    }

    const readRegistry = Effect.fnUntraced(function* (scope?: Extension.Scope) {
      const readOne = function* (targetScope: Extension.Scope) {
        const file = getRegistryFile(targetScope)
        const exists = yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false))
        if (!exists) return []
        const raw = yield* fs.readFileStringSafe(file).pipe(Effect.orElseSucceed(() => undefined))
        if (!raw) return []
        try {
          const parsed = JSON.parse(raw)
          return Array.isArray(parsed) ? (parsed as Extension.CIR[]) : []
        } catch {
          return []
        }
      }

      if (scope) return yield* readOne(scope)
      const projectItems = yield* readOne("project")
      const globalItems = yield* readOne("global")
      return [...projectItems, ...globalItems]
    })

    const writeRegistry = (items: Extension.CIR[], scope: Extension.Scope) =>
      Effect.gen(function* () {
        const file = getRegistryFile(scope)
        yield* fs.ensureDir(path.dirname(file)).pipe(Effect.ignore)
        yield* fs.writeFileString(file, JSON.stringify(items, null, 2)).pipe(Effect.ignore)
      })

    const recordHistory = (entry: Omit<HistoryEntry, "id" | "timestamp">) =>
      Effect.gen(function* () {
        const file = getHistoryFile(entry.scope)
        const fullEntry: HistoryEntry = {
          ...entry,
          id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          timestamp: Date.now(),
        }
        yield* fs.ensureDir(path.dirname(file)).pipe(Effect.ignore)
        const exists = yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false))
        let history: HistoryEntry[] = []
        if (exists) {
          const raw = yield* fs.readFileStringSafe(file).pipe(Effect.orElseSucceed(() => undefined))
          if (raw) {
            try {
              history = JSON.parse(raw)
            } catch {
              history = []
            }
          }
        }
        history.unshift(fullEntry)
        yield* fs.writeFileString(file, JSON.stringify(history.slice(0, 200), null, 2)).pipe(Effect.ignore)
      })

    return Service.of({
      list: Effect.fn("ExtensionRegistry.list")(function* (scope?: Extension.Scope) {
        return yield* readRegistry(scope)
      }),

      get: Effect.fn("ExtensionRegistry.get")(function* (id) {
        const items = yield* readRegistry()
        return items.find((i) => i.id === id)
      }),

      register: Effect.fn("ExtensionRegistry.register")(function* (cir) {
        const items = yield* readRegistry(cir.scope)
        const index = items.findIndex((i) => i.id === cir.id)
        const isUpdate = index >= 0
        if (isUpdate) {
          items[index] = cir
        } else {
          items.push(cir)
        }
        yield* writeRegistry(items, cir.scope)
        yield* recordHistory({
          extensionId: cir.id,
          name: cir.name,
          version: cir.version,
          action: isUpdate ? "update" : "install",
          scope: cir.scope,
          details: `Registered ${cir.name} (${cir.originPlatform}/${cir.category})`,
        })
      }),

      toggle: Effect.fn("ExtensionRegistry.toggle")(function* (id, enabled) {
        for (const scope of ["project", "global"] as const) {
          const items = yield* readRegistry(scope)
          const index = items.findIndex((i) => i.id === id)
          if (index >= 0 && items[index]) {
            const current = items[index]
            const updated: Extension.CIR = {
              ...current,
              enabled,
              status: enabled ? "enabled" : "disabled",
            }
            items[index] = updated
            yield* writeRegistry(items, scope)
            yield* recordHistory({
              extensionId: id,
              name: current.name,
              version: current.version,
              action: "toggle",
              scope,
              details: `Toggled extension ${enabled ? "enabled" : "disabled"}`,
            })
            return updated
          }
        }
        return undefined
      }),

      remove: Effect.fn("ExtensionRegistry.remove")(function* (id) {
        for (const scope of ["project", "global"] as const) {
          const items = yield* readRegistry(scope)
          const existing = items.find((i) => i.id === id)
          if (existing) {
            const filtered = items.filter((i) => i.id !== id)
            yield* writeRegistry(filtered, scope)
            yield* recordHistory({
              extensionId: id,
              name: existing.name,
              version: existing.version,
              action: "remove",
              scope,
              details: `Uninstalled extension ${existing.name}`,
            })
            return true
          }
        }
        return false
      }),

      checkForUpdates: Effect.fn("ExtensionRegistry.checkForUpdates")(function* (id) {
        const items = yield* readRegistry()
        const existing = items.find((i) => i.id === id)
        if (!existing) return undefined

        // For git sources, we can inspect remote HEAD or tag; for now synthesize a structured update check
        const updateInfo: Extension.ExtensionUpdateInfo = {
          id: existing.id,
          currentVersion: existing.version,
          latestVersion: existing.version, // Up-to-date by default unless new ref/commit
          updateAvailable: false,
          source: existing.source,
        }
        return updateInfo
      }),

      rollback: Effect.fn("ExtensionRegistry.rollback")(function* (id, targetVersion) {
        for (const scope of ["project", "global"] as const) {
          const items = yield* readRegistry(scope)
          const index = items.findIndex((i) => i.id === id)
          if (index >= 0 && items[index]) {
            const current = items[index]
            const previousVersion = current.version
            const updated: Extension.CIR = {
              ...current,
              version: targetVersion,
              status: "enabled",
              metadata: { ...current.metadata, rolledBackFrom: previousVersion },
            }
            items[index] = updated
            yield* writeRegistry(items, scope)
            yield* recordHistory({
              extensionId: id,
              name: current.name,
              version: targetVersion,
              action: "rollback",
              scope,
              details: `Rolled back from ${previousVersion} to ${targetVersion}`,
            })
            const record: Extension.RollbackRecord = {
              id: `rb_${Date.now()}`,
              extensionId: id,
              previousVersion,
              targetVersion,
              timestamp: Date.now(),
              reason: `User requested rollback to ${targetVersion}`,
            }
            return record
          }
        }
        return undefined
      }),

      getHistory: Effect.fn("ExtensionRegistry.getHistory")(function* (extensionId) {
        const readHistoryForScope = function* (scope: Extension.Scope) {
          const file = getHistoryFile(scope)
          const exists = yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false))
          if (!exists) return []
          const raw = yield* fs.readFileStringSafe(file).pipe(Effect.orElseSucceed(() => undefined))
          if (!raw) return []
          try {
            const list = JSON.parse(raw) as HistoryEntry[]
            return Array.isArray(list) ? list : []
          } catch {
            return []
          }
        }

        const projectHist = yield* readHistoryForScope("project")
        const globalHist = yield* readHistoryForScope("global")
        const combined = [...projectHist, ...globalHist].toSorted((a, b) => b.timestamp - a.timestamp)
        if (extensionId) {
          return combined.filter((h) => h.extensionId === extensionId)
        }
        return combined
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [FSUtil.node, Global.node] })
