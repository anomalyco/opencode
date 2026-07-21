export * as CodeModeInstructions from "./instructions"

import { Context, Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { AgentV2 } from "../agent"
import { CodeMode } from "../codemode"
import { CodeModeCatalog } from "./catalog"
import { Instructions } from "../instructions/index"

export interface Interface {
  readonly load: (agent: AgentV2.Selection) => Effect.Effect<Instructions.Instructions>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/CodeModeInstructions") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const codeMode = yield* CodeMode.Service

    return Service.of({
      load: Effect.fn("CodeModeInstructions.load")(function* (selection) {
        const catalog = selection.info ? ((yield* codeMode.materialize(selection.info.permissions)).catalog ?? []) : []
        // Sorted entries keep the stored snapshot canonical so identical catalogs hash identically.
        const entries = catalog.toSorted((left, right) => left.path.localeCompare(right.path))
        return Instructions.make<ReadonlyArray<CodeModeCatalog.Entry>>({
          key: Instructions.Key.make("core/codemode"),
          codec: Schema.toCodecJson(Schema.Array(CodeModeCatalog.Entry)),
          read: Effect.succeed(entries.length === 0 ? Instructions.removed : entries),
          render: {
            initial: (current) => CodeModeCatalog.render(current),
            changed: (previous, current) => CodeModeCatalog.update(previous, current),
            removed: () => "Code Mode tools are no longer available. Do not use any previously listed Code Mode tools.",
          },
        })
      }),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [CodeMode.node] })
