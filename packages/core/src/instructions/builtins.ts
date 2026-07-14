export * as InstructionBuiltIns from "./builtins"

import { makeLocationNode } from "../effect/app-node"
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { Location } from "../location"
import { Instructions } from "./index"

export interface Interface {
  readonly load: () => Effect.Effect<Instructions.Instructions>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/InstructionBuiltIns") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const location = yield* Location.Service
    const instructions = Instructions.combine([
      Instructions.make({
        key: Instructions.Key.make("core/environment"),
        codec: Schema.toCodecJson(Schema.String),
        read: Effect.sync(() =>
          [
            "<env>",
            `  Working directory: ${location.directory}`,
            `  Workspace root folder: ${location.project.directory}`,
            `  Is directory a git repo: ${location.vcs?.type === "git" ? "yes" : "no"}`,
            `  Platform: ${process.platform}`,
            "</env>",
          ].join("\n"),
        ),
        render: {
          initial: (environment) =>
            ["Here is some useful information about the environment you are running in:", environment].join("\n"),
          changed: (_previous, environment) => ["The environment you are running in is now:", environment].join("\n"),
        },
      }),
      Instructions.make({
        key: Instructions.Key.make("core/date"),
        codec: Schema.toCodecJson(Schema.String),
        read: DateTime.nowAsDate.pipe(Effect.map((date) => date.toDateString())),
        render: {
          initial: (date) => `Today's date: ${date}`,
          changed: (_previous, date) => `Today's date is now: ${date}`,
        },
      }),
    ])

    return Service.of({ load: () => Effect.succeed(instructions) })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Location.node] })
