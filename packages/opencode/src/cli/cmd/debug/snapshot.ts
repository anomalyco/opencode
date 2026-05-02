import { Effect } from "effect"
import { Snapshot } from "../../../snapshot"
import { effectCmd } from "../../effect-cmd"
import { cmd } from "../cmd"
import { InstanceRef } from "@/effect/instance-ref"
import { InstanceStore } from "@/project/instance-store"

export const SnapshotCommand = cmd({
  command: "snapshot",
  describe: "snapshot debugging utilities",
  builder: (yargs) => yargs.command(TrackCommand).command(PatchCommand).command(DiffCommand).demandCommand(),
  async handler() {},
})

const TrackCommand = effectCmd({
  command: "track",
  describe: "track current snapshot state",
  handler: Effect.fn("Cli.debug.snapshot.track")(function* () {
    const ctx = yield* InstanceRef
    if (!ctx) return
    const store = yield* InstanceStore.Service
    return yield* Effect.gen(function* () {
      const out = yield* Snapshot.Service.use((svc) => svc.track())
      console.log(out)
    }).pipe(Effect.ensuring(store.dispose(ctx)))
  }),
})

const PatchCommand = effectCmd({
  command: "patch <hash>",
  describe: "show patch for a snapshot hash",
  builder: (yargs) =>
    yargs.positional("hash", {
      type: "string",
      description: "hash",
      demandOption: true,
    }),
  handler: Effect.fn("Cli.debug.snapshot.patch")(function* (args) {
    const ctx = yield* InstanceRef
    if (!ctx) return
    const store = yield* InstanceStore.Service
    return yield* Effect.gen(function* () {
      const out = yield* Snapshot.Service.use((svc) => svc.patch(args.hash))
      console.log(out)
    }).pipe(Effect.ensuring(store.dispose(ctx)))
  }),
})

const DiffCommand = effectCmd({
  command: "diff <hash>",
  describe: "show diff for a snapshot hash",
  builder: (yargs) =>
    yargs.positional("hash", {
      type: "string",
      description: "hash",
      demandOption: true,
    }),
  handler: Effect.fn("Cli.debug.snapshot.diff")(function* (args) {
    const ctx = yield* InstanceRef
    if (!ctx) return
    const store = yield* InstanceStore.Service
    return yield* Effect.gen(function* () {
      const out = yield* Snapshot.Service.use((svc) => svc.diff(args.hash))
      console.log(out)
    }).pipe(Effect.ensuring(store.dispose(ctx)))
  }),
})
