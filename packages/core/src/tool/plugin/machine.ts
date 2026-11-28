export * as MachineTools from "./machine.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { ToolFailure } from "@opencode/ai/effect"
import { Effect, Schema } from "effect"
import { Environment } from "../../environment/index.js"
import { FileAccess } from "../../file-access.js"
import { FileWrite } from "../../file-write.js"
import { Flag } from "../../flag.js"
import { Machine } from "../../machine/index.js"
import { Machines } from "../../machine/machines.js"
import { Permission } from "../../permission.js"

const ListOutput = Schema.Struct({ machines: Schema.Array(Machines.Info) })

const FileInput = Schema.Struct({
  from: Schema.String.annotate({ description: "The file, as a machine path such as `gpu:~/data.bin`" }),
  to: Schema.String.annotate({
    description:
      "Where it goes, on another machine, such as `pro:/srv/data.bin`. Its directory must exist; a file there is replaced.",
  }),
})
const FileOutput = Schema.Struct({ from: Schema.String, to: Schema.String })

const Port = Schema.Struct({
  machine: Environment.ID,
  port: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65_535 })),
})
const ForwardInput = Schema.Struct({
  from: Port.annotate({ description: "The machine and loopback port to listen on" }),
  to: Port.annotate({ description: "The machine and loopback port each connection reaches" }),
})
const ForwardOutput = Schema.Struct({ id: Schema.String })
const UnforwardInput = Schema.Struct({
  id: Schema.String.annotate({ description: "The id `machine.forward` returned" }),
})
const UnforwardOutput = Schema.Struct({ removed: Schema.Boolean })
const UpdateInput = Schema.Struct({
  machine: Environment.ID,
  version: Machine.Update.fields.version.pipe(Schema.optional).annotate({
    description: `The worker version, such as \`${Machine.WORKER_VERSION}\`. Defaults to the one this server is built with.`,
  }),
})
const UpdateOutput = Schema.Struct({ machine: Environment.ID, version: Schema.String })

export const Plugin = {
  id: "opencode.tool.machine",
  effect: Effect.fn("MachineTools.Plugin")(function* (ctx: Context) {
    const machines = yield* Machines.Service
    const access = yield* FileAccess.Service
    const fileWrite = yield* FileWrite.Service
    const permission = yield* Permission.Service
    if (!(yield* Flag.enabled("machines"))) return

    // Copies a file between two machines with the approvals the file tools ask for: read on the source and edit on the
    // target, and for a move edit on the source too, which is removed once the copy is written.
    const transfer = (input: typeof FileInput.Type, context: FileAccess.Invocation, move: boolean) =>
      Effect.gen(function* () {
        const source = yield* access.resolve({ path: input.from, kind: "file" })
        const target = yield* access.resolve({ path: input.to, kind: "file" })
        if (!source.machine || !target.machine)
          return yield* new ToolFailure({ message: "Both paths must be on machines, such as `gpu:~/file`." })
        yield* access.authorizeExternal([source, target], context)
        yield* permission.assert({
          action: "read",
          resources: [source.resource],
          save: [FileAccess.always(source)],
          ...Permission.invocation(context),
        })
        yield* fileWrite.authorize(target, context)
        if (move) yield* fileWrite.authorize(source, context)
        yield* machines.copy(
          { machine: source.machine, path: source.absolute },
          { machine: target.machine, path: target.absolute },
        )
        if (move) yield* source.environment.files.remove(source.absolute)
        return {
          output: { from: source.resource, to: target.resource },
          content: `${move ? "Moved" : "Copied"} ${source.resource} to ${target.resource}.`,
        }
      }).pipe(
        Effect.mapError((error) =>
          error instanceof ToolFailure
            ? error
            : new ToolFailure({ message: `Unable to ${move ? "move" : "copy"} ${input.from} to ${input.to}`, error }),
        ),
      )

    // Registered even with no machines, so adding the first one mid-session leaves the tool catalog as it was.
    yield* ctx.tool
      .transform((editor) => {
        editor.namespace({
          name: "machine",
          description:
            "The other computers this server can work on. See which machines exist and which are connected, to pick one or to run the same thing on several. Use a machine by naming it in a path, such as `gpu:~/project`, for the file tools or as the shell tool's workdir. Copy or move a file between two machines, or map a port on one to a port on another; the machines connect to each other directly for it.",
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
        editor.add({
          name: "copy",
          description:
            "Copy one file from one machine to another, directly between the two machines. Only single files, not directories.",
          input: FileInput,
          output: FileOutput,
          options: { namespace: "machine", codemode: true },
          execute: (input, context) => transfer(input, context, false),
        })
        editor.add({
          name: "move",
          description:
            "Move one file from one machine to another, directly between the two machines: the source is removed once the copy is written. Only single files, not directories.",
          input: FileInput,
          output: FileOutput,
          options: { namespace: "machine", codemode: true },
          execute: (input, context) => transfer(input, context, true),
        })
        editor.add({
          name: "forward",
          description:
            "Map a loopback port on one machine to a loopback port on another: each connection to `from` reaches `to`, directly between the two machines, until `machine.unforward` or either machine disconnects. Returns the forward's id.",
          input: ForwardInput,
          output: ForwardOutput,
          options: { namespace: "machine", codemode: true },
          execute: (input, context) =>
            Effect.gen(function* () {
              const from = `${input.from.machine}:${input.from.port}`
              const to = `${input.to.machine}:${input.to.port}`
              yield* permission.assert({
                action: "machine_forward",
                resources: [`${from} ${to}`],
                save: [`${from} ${to}`],
                ...Permission.invocation(context),
              })
              const id = yield* machines.forward(input.from, input.to)
              return { output: { id }, content: `Forwarding ${from} to ${to} (${id}).` }
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: "Unable to forward the port", error }))),
        })
        editor.add({
          name: "update",
          description:
            "Ask a machine's worker to update itself to a version. The worker fetches it from the source it was set up with, restarts into it, and rolls back unless the new version connects again; its running commands, peer links and forwards end. `machine.list` shows each worker's `version`.",
          input: UpdateInput,
          output: UpdateOutput,
          options: { namespace: "machine", codemode: true },
          execute: (input, context) =>
            Effect.gen(function* () {
              const version = input.version ?? Machine.WORKER_VERSION
              yield* permission.assert({
                action: "machine_update",
                resources: [input.machine],
                save: [input.machine],
                ...Permission.invocation(context),
              })
              yield* machines.update(input.machine, version)
              return {
                output: { machine: input.machine, version },
                content: `Asked ${input.machine} to update its worker to ${version}.`,
              }
            }).pipe(
              Effect.mapError((error) => new ToolFailure({ message: `Unable to update ${input.machine}`, error })),
            ),
        })
        editor.add({
          name: "unforward",
          description: "End a forward `machine.forward` started.",
          input: UnforwardInput,
          output: UnforwardOutput,
          options: { namespace: "machine", codemode: true },
          execute: (input) => Effect.map(machines.unforward(input.id), (removed) => ({ output: { removed } })),
        })
      })
      .pipe(Effect.orDie)
  }),
}
