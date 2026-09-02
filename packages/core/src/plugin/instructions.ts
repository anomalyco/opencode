export * as PluginInstructions from "./instructions.js"

import { Instruction } from "@opencode-ai/plugin/instructions"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { Cause, Context, Effect, Layer, Schema } from "effect"
import { Instructions } from "../instructions/index.js"
import { State } from "../state.js"

type Source = (context: Instruction.Context) => Instructions.Source

export interface Interface extends State.Transformable<Instruction.EffectDraft> {
  readonly load: (context: Instruction.Context) => Instructions.List
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PluginInstructions") {}

export const layer = Layer.sync(Service, () => {
  const state = State.create<Map<Instructions.Key, Source>, Instruction.EffectDraft>({
    name: "plugin.instructions",
    initial: () => new Map(),
    draft: (sources) => ({
      add: (definition) => {
        const key = Schema.decodeUnknownSync(Instructions.Key)(definition.key)
        if (sources.has(key)) throw new Instructions.DuplicateKeyError({ key })
        sources.set(key, (context) => {
          const [source] = Instructions.make({
            key,
            codec: definition.codec,
            read: Effect.suspend(() => definition.read(context)).pipe(
              Effect.orDie,
              Effect.map((value) => {
                if (value === Instruction.removed) return Instructions.removed
                if (value === Instruction.unavailable) return Instructions.unavailable
                return value
              }),
            ),
            render: definition.render,
          })
          return {
            ...source,
            read: source.read.pipe(
              Effect.catchCauseIf(
                (cause) => !Cause.hasInterrupts(cause),
                () =>
                  Effect.logWarning("plugin instruction source unavailable", { key }).pipe(
                    Effect.as(Instructions.unavailable),
                  ),
              ),
            ),
          }
        })
      },
    }),
  })
  return Service.of({
    transform: state.transform,
    reload: state.reload,
    load: (context) => [...state.get().values()].map((make) => make(context)),
  })
})

export const node = makeLocationNode({ service: Service, layer, deps: [] })
