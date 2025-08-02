import { Snapshot } from "../../../snapshot"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"

export const SnapshotCommand = cmd({
  command: "snapshot",
  describe: "snapshot debugging tools",
  builder: (yargs) => yargs.command(TrackCommand).command(PatchCommand).command(DiffCommand).demandCommand(),
  async handler() {},
})

const TrackCommand = cmd({
  command: "track",
  describe: "track snapshot changes",
  async handler() {
    await bootstrap({ cwd: process.cwd() }, async () => {
      console.log(await Snapshot.track())
    })
  },
})

const PatchCommand = cmd({
  command: "patch <hash>",
  describe: "generate patch for snapshot",
  builder: (yargs) =>
    yargs.positional("hash", {
      type: "string",
      description: "hash",
      demandOption: true,
    }),
  async handler(args) {
    await bootstrap({ cwd: process.cwd() }, async () => {
      console.log(await Snapshot.patch(args.hash))
    })
  },
})

const DiffCommand = cmd({
  command: "diff <hash>",
  describe: "show diff for snapshot",
  builder: (yargs) =>
    yargs.positional("hash", {
      type: "string",
      description: "hash",
      demandOption: true,
    }),
  async handler(args) {
    await bootstrap({ cwd: process.cwd() }, async () => {
      console.log(await Snapshot.diff(args.hash))
    })
  },
})
