import { Snapshot } from "../../../snapshot"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"

export const SnapshotCommand = cmd({
  command: "snapshot",
  builder: (yargs) => yargs.command(CreateCommand).command(RestoreCommand).command(DiffCommand).demandCommand(),
  async handler() {},
})

const CreateCommand = cmd({
  command: "create",
  async handler() {
    await bootstrap({ cwd: process.cwd() }, async () => {
      const result = await Snapshot.create("test")
      console.log(result)
    })
  },
})

const RestoreCommand = cmd({
  command: "restore <commit>",
  builder: (yargs) =>
    yargs.positional("commit", {
      type: "string",
      description: "commit",
      demandOption: true,
    }),
  async handler(args) {
    await bootstrap({ cwd: process.cwd() }, async () => {
      await Snapshot.restore("test", args.commit)
      console.log("restored")
    })
  },
})

export const DiffCommand = cmd({
  command: "diff <commit>",
  describe: "diff",
  builder: (yargs) =>
    yargs.positional("commit", {
      type: "string",
      description: "commit",
      demandOption: true,
    }),
  async handler(args) {
    await bootstrap({ cwd: process.cwd() }, async () => {
      const diff = await Snapshot.diff("test", args.commit)
      console.log(diff)
    })
  },
})
