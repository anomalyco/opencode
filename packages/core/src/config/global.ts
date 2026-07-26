export * as ConfigGlobal from "./global"

import { randomUUID } from "node:crypto"
import path from "node:path"
import { Context, Effect, Layer } from "effect"
import { applyEdits, modify, type JSONPath } from "jsonc-parser"
import { makeGlobalNode } from "../effect/app-node"
import { FSUtil } from "../fs-util"
import { Global } from "../global"
import { EffectFlock } from "../util/effect-flock"

export interface Interface {
  readonly update: (jsonPath: JSONPath, value: unknown) => Effect.Effect<void, FSUtil.Error | EffectFlock.LockError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ConfigGlobal") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const flock = yield* EffectFlock.Service

    return Service.of({
      update: Effect.fn("ConfigGlobal.update")(function* (jsonPath, value) {
        yield* flock.withLock(
          Effect.gen(function* () {
            const existingFiles = yield* Effect.filter(
              ["opencode.jsonc", "opencode.json"].map((name) => path.join(global.config, name)),
              fs.existsSafe,
            )
            const filepath = existingFiles[0] ?? path.join(global.config, "opencode.json")
            const text = (yield* fs.readFileStringSafe(filepath)) ?? "{}"
            const next = applyEdits(
              text,
              modify(text, jsonPath, value, { formattingOptions: { tabSize: 2, insertSpaces: true } }),
            )
            const temp = `${filepath}.${randomUUID()}.tmp`
            yield* fs.writeWithDirs(temp, next)
            yield* fs.rename(temp, filepath).pipe(Effect.ensuring(fs.remove(temp).pipe(Effect.ignore)))
          }),
          "global-config",
        )
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [EffectFlock.node, FSUtil.node, Global.node] })
