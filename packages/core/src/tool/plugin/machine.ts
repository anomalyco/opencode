export * as MachineTools from "./machine.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { Flag } from "../../flag.js"
import { Machines } from "../../machine/machines.js"

const ListOutput = Schema.Struct({ machines: Schema.Array(Machines.Info) })

export const Plugin = {
  id: "opencode.tool.machine",
  effect: Effect.fn("MachineTools.Plugin")(function* (ctx: Context) {
    const machines = yield* Machines.Service
    if (!(yield* Flag.enabled("machines"))) return

    // Registered even with no machines, so adding the first one mid-session leaves the tool catalog as it was.
    yield* ctx.tool
      .transform((editor) => {
        editor.namespace({
          name: "machine",
          description:
            "The other computers this server can work on. See which machines exist and which are connected, to pick one or to run the same thing on several. Use a machine by naming it in a path, such as `gpu:~/project`, for the file tools or as the shell tool's workdir.",
        })
        editor.add({
          name: "list",
          description:
            "List the machines: each one's name (`id`), whether it is connected (`online`), whether it has joined (`paired`, false while it is still waiting to join), and its system and chip (`os`, `arch`) while it is connected.",
          input: Schema.Struct({}),
          output: ListOutput,
          options: { namespace: "machine", codemode: true },
          execute: () => Effect.map(machines.list(), (list) => ({ output: { machines: list } })),
        })
      })
      .pipe(Effect.orDie)
  }),
}
