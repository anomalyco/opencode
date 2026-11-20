export * as MachineInstructions from "./instructions.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer, Schema } from "effect"
import { Flag } from "../flag.js"
import { Instructions } from "../instructions/index.js"
import { Machines } from "./machines.js"

const render = (names: ReadonlyArray<string>) =>
  [
    `Other machines are available: ${names.join(", ")}.`,
    `Name one in a path, as in ${names[0]}:/work/file, for the read, write, edit and patch tools, and as the shell tool's workdir to run a command there. A machine path must be absolute. grep and glob cannot search another machine yet. A machine may be offline; the tool says so when it is.`,
  ].join("\n")

const update = Instructions.listUpdate<string>({
  key: (name) => name,
  changed: () => false,
  entries: (names) => [names.join(", ")],
  render,
  text: {
    replaced: "The available machines have changed. This list supersedes the previous available machines list.",
    added: "New machines are available in addition to those previously listed:",
    changed:
      "The following machines have changed. Each entry replaces the previously listed machine with the same name:",
    removed: (names) => `The following machines are no longer available and must not be used: ${names}.`,
  },
})

export interface Interface {
  /** Lists the machines a tool path can name, when the `machines` flag is on. */
  readonly load: () => Effect.Effect<Instructions.List>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/MachineInstructions") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const flags = yield* Flag.Service
    const machines = yield* Machines.Service

    return Service.of({
      load: Effect.fn("MachineInstructions.load")(function* () {
        // Names only: a connection that drops and returns must append nothing; a call on an offline machine says so.
        const names = (yield* machines.list()).map((machine) => machine.id).toSorted()
        return Instructions.make<ReadonlyArray<string>>({
          key: Instructions.Key.make("core/machines"),
          codec: Schema.toCodecJson(Schema.Array(Schema.String)),
          read: Effect.succeed((yield* flags.enabled("machines")) && names.length > 0 ? names : Instructions.removed),
          render: {
            initial: render,
            changed: update,
            removed: () => "Other machines are no longer available. Do not use any previously listed machine.",
          },
        })
      }),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Flag.node, Machines.node] })
