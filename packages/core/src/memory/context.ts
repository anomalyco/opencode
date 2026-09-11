import { Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { SystemContext } from "../system-context/index"
import { SystemContextRegistry } from "../system-context/registry"
import * as Memory from "./index"

export * as MemoryContext from "./context"

const MemoryEntry = Schema.Struct({
  id: Schema.String,
  content: Schema.String,
})
type MemoryEntry = typeof MemoryEntry.Type

const key = SystemContext.Key.make("core/memory")

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const memory = yield* Memory.Service
    const registry = yield* SystemContextRegistry.Service

    const load = Effect.fn("MemoryContext.load")(function* () {
      const memories = yield* memory.list()
      if (memories.length === 0) return SystemContext.unavailable
      return memories.map((m) => ({ id: m.id, content: m.content }))
    })

    const source = (value: ReadonlyArray<MemoryEntry> | SystemContext.Unavailable) =>
      SystemContext.make({
        key,
        codec: Schema.toCodecJson(Schema.Array(MemoryEntry)),
        load: Effect.succeed(value),
        baseline: render,
        update: (_previous, current) =>
          `Project memories have been updated:\n\n${render(current)}`,
        removed: () => "Previously loaded project memories no longer apply.",
      })

    yield* registry.register({
      key,
      load: load().pipe(
        Effect.map((entries) =>
          entries === SystemContext.unavailable
            ? source(entries)
            : entries.length === 0
              ? SystemContext.empty
              : source(entries),
        ),
        Effect.catch(() => Effect.succeed(source(SystemContext.unavailable))),
        Effect.catchDefect(() => Effect.succeed(source(SystemContext.unavailable))),
      ),
    })
  }),
)

export const node = makeLocationNode({
  name: "memory-context",
  layer,
  deps: [Memory.node, SystemContextRegistry.node],
})

function render(entries: ReadonlyArray<MemoryEntry>) {
  if (entries.length === 0) return ""
  const items = entries.map((m) => `- ${m.content}`).join("\n")
  return `The following are learnings from previous sessions on this project. Treat them as established context:\n<project-memory>\n${items}\n</project-memory>`
}
