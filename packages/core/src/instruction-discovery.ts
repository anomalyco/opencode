export * as InstructionDiscovery from "./instruction-discovery"

import { Context, Effect, Layer, Schema, Types } from "effect"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { Bus } from "./bus"
import { Instructions } from "./instructions/index"
import { AbsolutePath } from "./schema"
import { State } from "./state"

export class File extends Schema.Class<File>("InstructionDiscovery.File")({
  path: AbsolutePath,
  content: Schema.String,
}) {}

const Files = Schema.Array(File)
const key = Instructions.Key.make("core/instructions")

export const Event = {
  Updated: Bus.ephemeral({ type: "instruction-discovery.updated", schema: {} }),
}

export type Data = {
  files: Map<AbsolutePath, Types.DeepMutable<File>>
  available: boolean
}

export type Draft = {
  list: () => readonly Types.DeepMutable<File>[]
  // Map insertion order is render order: config adds global then nearest-to-farthest project files;
  // sibling contributors interleave by transform registration order.
  add: (file: File) => void
  update: (path: string, update: (file: Types.DeepMutable<File>) => void) => void
  remove: (path: string) => void
  unavailable: () => void
}

export interface Interface extends State.Transformable<Draft> {
  // Discovery policy lives here because internal plugins have no per-composition options channel.
  // Move it into plugin config once plugins can consume their own options.
  readonly project: boolean
  readonly list: () => Effect.Effect<File[] | Instructions.Unavailable>
  readonly load: () => Effect.Effect<Instructions.List>
}

export const Options = Schema.Struct({
  project: Schema.optional(Schema.Boolean),
})
export type Options = typeof Options.Type

export class Service extends Context.Service<Service, Interface>()("@opencode/InstructionDiscovery") {}

export const layer = (options?: Options) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const state = State.create<Data, Draft>({
        name: "instruction-discovery",
        initial: () => ({ files: new Map(), available: true }),
        draft: (draft) => ({
          list: () => Array.from(draft.files.values()),
          add: (file) => draft.files.set(file.path, new File(file) as Types.DeepMutable<File>),
          update: (path, update) => {
            const current = draft.files.get(AbsolutePath.make(path))
            if (!current) return
            update(current)
            current.path = AbsolutePath.make(path)
          },
          remove: (path) => draft.files.delete(AbsolutePath.make(path)),
          unavailable: () => {
            draft.available = false
          },
        }),
        finalize: () => bus.publish(Event.Updated, {}).pipe(Effect.asVoid),
      })

      const source = (value: ReadonlyArray<File> | Instructions.Unavailable | Instructions.Removed) =>
        Instructions.make<ReadonlyArray<File>>({
          key,
          codec: Schema.toCodecJson(Files),
          read: Effect.succeed(value),
          render: {
            initial: render,
            changed: (_previous, current) =>
              `These instructions replace all previously loaded ambient instructions.\n\n${render(current)}`,
            removed: () => "Previously loaded instructions no longer apply.",
          },
        })

      const list = Effect.fn("InstructionDiscovery.list")(function* () {
        const current = state.get()
        if (!current.available) return Instructions.unavailable
        return Array.from(current.files.values())
      })

      return Service.of({
        project: options?.project !== false,
        transform: state.transform,
        reload: state.reload,
        list,
        load: Effect.fn("InstructionDiscovery.load")(function* () {
          const files = yield* list()
          if (!Array.isArray(files)) return source(files)
          return source(files.length === 0 ? Instructions.removed : files)
        }),
      })
    }),
  )

export function configured(options?: Options) {
  return makeLocationNode({
    service: Service,
    layer: layer(options),
    deps: [Bus.node],
  })
}

export const node = configured()

function render(files: ReadonlyArray<File>) {
  return files.map((file) => `Instructions from: ${file.path}\n${file.content}`).join("\n\n")
}
