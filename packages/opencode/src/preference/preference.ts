import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import path from "path"
import { Context, Effect, Layer } from "effect"
import { Global } from "@opencode-ai/core/global"
import { FSUtil } from "@opencode-ai/core/fs-util"

const FILENAME = "preferences.md"

export interface Interface {
  readonly path: () => Effect.Effect<string>
  readonly read: () => Effect.Effect<string | undefined, FSUtil.Error>
  readonly write: (content: string) => Effect.Effect<void, FSUtil.Error>
  readonly systemPrompt: () => Effect.Effect<string | undefined, FSUtil.Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Preference") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const global = yield* Global.Service
    const fs = yield* FSUtil.Service

    const filePath = path.join(global.config, FILENAME)

    const read = Effect.fn("Preference.read")(function* () {
      return yield* fs.readFileStringSafe(filePath)
    })

    const write = Effect.fn("Preference.write")(function* (content: string) {
      yield* fs.writeFileString(filePath, content)
    })

    const systemPrompt = Effect.fn("Preference.systemPrompt")(function* () {
      const content = yield* read()
      if (!content || !content.trim()) return undefined
      return `User Preferences (from: ${filePath})\n${content}`
    })

    return Service.of({
      path: () => Effect.succeed(filePath),
      read,
      write,
      systemPrompt,
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Global.layer), Layer.provide(FSUtil.defaultLayer))
export const node = LayerNode.make(layer, [Global.node, FSUtil.node])

export * as Preference from "./preference"
