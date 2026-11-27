export * as MachineInstructions from "./instructions.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer, Schema } from "effect"
import { Flag } from "../flag.js"
import { Instructions } from "../instructions/index.js"
import { Machines } from "./machines.js"

// "ready" and "away" are one entry, so a connection that drops and returns appends nothing; a call on a machine that is
// away says so. Only a machine that needs someone to act, such as one waiting to join or refused, is listed apart.
const Entry = Schema.Struct({ name: Schema.String, availability: Schema.Literals(["usable", "needs-you"]) })
type Entry = typeof Entry.Type

const names = (entries: ReadonlyArray<Entry>, availability: Entry["availability"]) =>
  entries.filter((entry) => entry.availability === availability).map((entry) => entry.name)

const NEEDS_YOU = "can't be used until someone acts on that machine or this server"

const render = (entries: ReadonlyArray<Entry>) => {
  const usable = names(entries, "usable")
  const blocked = names(entries, "needs-you")
  return [
    ...(usable.length === 0
      ? []
      : [
          `Other machines are available: ${usable.join(", ")}.`,
          `Name one in a path, as in ${usable[0]}:/work/file, for the read, write, edit and patch tools, and as the shell tool's workdir to run a command there. A machine path is absolute or starts with ~/ for that machine's home. grep and glob cannot search another machine; run a search command there with the shell tool instead. A machine may be offline; the tool says so when it is.`,
        ]),
    ...(blocked.length === 0 ? [] : [`These machines ${NEEDS_YOU}: ${blocked.join(", ")}.`]),
  ].join("\n")
}

const update = Instructions.listUpdate<Entry>({
  key: (entry) => entry.name,
  changed: (previous, current) => previous.availability !== current.availability,
  entries: (entries) =>
    entries.map((entry) => (entry.availability === "usable" ? entry.name : `${entry.name} (${NEEDS_YOU})`)),
  render,
  text: {
    replaced: "The machines have changed. This list supersedes the previous machines list.",
    added: "New machines, in addition to those previously listed:",
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
        const entries = (yield* machines.statuses()).map(
          ({ id, status }): Entry => ({
            name: id,
            availability: Machines.availability(status) === "needs-you" ? "needs-you" : "usable",
          }),
        )
        return Instructions.make<ReadonlyArray<Entry>>({
          // v2: the value went from names to entries, and the old one is not decoded as the new.
          key: Instructions.Key.make("core/machines/v2"),
          codec: Schema.toCodecJson(Schema.Array(Entry)),
          read: Effect.succeed(
            (yield* flags.enabled("machines")) && entries.length > 0 ? entries : Instructions.removed,
          ),
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
