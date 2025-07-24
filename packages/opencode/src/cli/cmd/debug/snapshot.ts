import { Session } from "../../../session"
import { Snapshot } from "../../../snapshot"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"

export const SnapshotCommand = cmd({
  command: "snapshot",
  builder: (yargs) =>
    yargs.command(CreateCommand).command(RestoreCommand).command(DiffCommand).command(RevertCommand).demandCommand(),
  async handler() {},
})

const CreateCommand = cmd({
  command: "create",
  async handler() {
    await bootstrap({ cwd: process.cwd() }, async () => {
      const result = await Snapshot.create()
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
      await Snapshot.restore(args.commit)
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
      const diff = await Snapshot.diff(args.commit)
      console.log(diff)
    })
  },
})

export const RevertCommand = cmd({
  command: "revert <sessionID> <messageID>",
  describe: "revert",
  builder: (yargs) =>
    yargs
      .positional("sessionID", {
        type: "string",
        description: "sessionID",
        demandOption: true,
      })
      .positional("messageID", {
        type: "string",
        description: "messageID",
        demandOption: true,
      }),
  async handler(args) {
    await bootstrap({ cwd: process.cwd() }, async () => {
      const session = await Session.revert({
        sessionID: args.sessionID,
        messageID: args.messageID,
      })
      console.log(session?.revert)
    })
  },
})
