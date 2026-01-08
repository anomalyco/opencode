import { Snapshot } from "../../../snapshot"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"

export const SnapshotCommand = cmd({
  command: "snapshot",
  describe: "snapshot debugging utilities",
  builder: (yargs) => yargs.command(TrackCommand).command(PatchCommand).command(DiffCommand).demandCommand(),
  async handler() {},
})

const TrackCommand = cmd({
  command: "track",
  describe: "track current snapshot state",
  async handler() {
    await bootstrap(process.cwd(), async () => {
      console.log(await Snapshot.track())
    })
  },
})

const PatchCommand = cmd({
  command: "patch <hash>",
  describe: "show patch for a snapshot hash",
  builder: (yargs) =>
    yargs.positional("hash", {
      type: "string",
      description: "hash",
      demandOption: true,
    }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      console.log(await Snapshot.patch(args.hash))
    })
  },
})

const DiffCommand = cmd({
  command: "diff <hash>",
  describe: "show diff for a snapshot hash",
  builder: (yargs) =>
    yargs.positional("hash", {
      type: "string",
      description: "hash",
      demandOption: true,
    }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      console.log(await Snapshot.diff(args.hash))
    })
  },
})
