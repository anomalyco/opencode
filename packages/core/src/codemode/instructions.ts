export * as CodeModeInstructions from "./instructions"

import { Context, Effect, Layer, Schema } from "effect"
import { AgentV2 } from "../agent"
import { CodeMode } from "../codemode"
import { makeLocationNode } from "../effect/app-node"
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
        const instructions = selection.info
          ? (yield* codeMode.materialize(selection.info.permissions)).instructions
          : undefined
        return Instructions.make({
          key: Instructions.Key.make("core/codemode"),
          codec: Schema.toCodecJson(Schema.String),
          read: Effect.succeed(instructions ?? Instructions.removed),
          render: {
            initial: (current) => current,
            changed: (_previous, current) =>
              [
                "The Code Mode tool catalog has changed. This catalog supersedes the previous Code Mode tool catalog.",
                current,
              ].join("\n\n"),
            removed: () =>
              "Code Mode tools are no longer available. Do not use any previously listed Code Mode tools.",
          },
        })
      }),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [CodeMode.node] })
