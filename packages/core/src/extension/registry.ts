export * as ExtensionRegistry from "./registry.js"

import path from "path"
import { Context, Effect, Layer, Option } from "effect"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Extension } from "@opencode/schema/extension"
import { Location } from "../location.js"

export interface Interface {
  readonly list: () => Effect.Effect<Extension.CIR[]>
  readonly get: (id: string) => Effect.Effect<Extension.CIR | undefined>
  readonly register: (cir: Extension.CIR) => Effect.Effect<void>
  readonly toggle: (id: string, enabled: boolean) => Effect.Effect<Extension.CIR | undefined>
  readonly remove: (id: string) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ExtensionRegistry") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const locationOpt = yield* Effect.serviceOption(Location.Service)
    const location = Option.getOrUndefined(locationOpt)

    const registryFile = location?.project?.directory
      ? path.join(location.project.directory, ".opencode", "extensions.json")
      : path.join(global.config, "extensions.json")

    const readRegistry = Effect.fnUntraced(function* () {
      const exists = yield* fs.exists(registryFile).pipe(Effect.orElseSucceed(() => false))
      if (!exists) return []
      const raw = yield* fs.readFileStringSafe(registryFile).pipe(Effect.orElseSucceed(() => undefined))
      if (!raw) return []
      try {
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? (parsed as Extension.CIR[]) : []
      } catch {
        return []
      }
    })

    const writeRegistry = (items: Extension.CIR[]) =>
      Effect.gen(function* () {
        yield* fs.ensureDir(path.dirname(registryFile)).pipe(Effect.ignore)
        yield* fs.writeFileString(registryFile, JSON.stringify(items, null, 2)).pipe(Effect.ignore)
      })

    return Service.of({
      list: Effect.fn("ExtensionRegistry.list")(function* () {
        return yield* readRegistry()
      }),

      get: Effect.fn("ExtensionRegistry.get")(function* (id) {
        const items = yield* readRegistry()
        return items.find((i) => i.id === id)
      }),

      register: Effect.fn("ExtensionRegistry.register")(function* (cir) {
        const items = yield* readRegistry()
        const index = items.findIndex((i) => i.id === cir.id)
        if (index >= 0) {
          items[index] = cir
        } else {
          items.push(cir)
        }
        yield* writeRegistry(items)
      }),

      toggle: Effect.fn("ExtensionRegistry.toggle")(function* (id, enabled) {
        const items = yield* readRegistry()
        const index = items.findIndex((i) => i.id === id)
        if (index < 0) return undefined
        const current = items[index]
        if (!current) return undefined
        const updated: Extension.CIR = {
          ...current,
          enabled,
          status: enabled ? "enabled" : "disabled",
        }
        items[index] = updated
        yield* writeRegistry(items)
        return updated
      }),

      remove: Effect.fn("ExtensionRegistry.remove")(function* (id) {
        const items = yield* readRegistry()
        const initialLen = items.length
        const filtered = items.filter((i) => i.id !== id)
        if (filtered.length !== initialLen) {
          yield* writeRegistry(filtered)
          return true
        }
        return false
      }),
    })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [FSUtil.node, Global.node],
})
