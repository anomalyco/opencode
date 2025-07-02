import { Snapshot } from "../../../snapshot"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"

export const SnapshotCommand = cmd({
  command: "snapshot",
  builder: (yargs) =>
    yargs
      .command(SnapshotCreateCommand)
      .command(SnapshotRestoreCommand)
      .demandCommand(),
  async handler() {},
})

export const SnapshotCreateCommand = cmd({
  command: "create",
  async handler() {
    await bootstrap({ cwd: process.cwd() }, async () => {
      const result = await Snapshot.create("test")
      console.log(result)
    })
  },
})

export const SnapshotRestoreCommand = cmd({
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
