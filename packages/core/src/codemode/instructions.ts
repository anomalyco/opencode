export * as CodeModeInstructions from "./instructions"

import { Context, Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { Instructions } from "../instructions/index"

export interface Interface {
  readonly load: (catalog?: string) => Effect.Effect<Instructions.Instructions>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/CodeModeInstructions") {}

const layer = Layer.succeed(
  Service,
  Service.of({
    load: Effect.fn("CodeModeInstructions.load")((catalog) =>
      Effect.succeed(
        Instructions.make({
          key: Instructions.Key.make("core/codemode"),
          codec: Schema.toCodecJson(Schema.String),
          read: Effect.succeed(catalog ?? Instructions.removed),
          render: {
            initial: (current) => current,
            changed: (_previous, current) =>
              [
                "The Code Mode tool catalog has changed. This catalog supersedes the previous Code Mode tool catalog.",
                current,
              ].join("\n\n"),
            removed: () => "Code Mode tools are no longer available. Do not use any previously listed Code Mode tools.",
          },
        }),
      ),
    ),
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [] })
