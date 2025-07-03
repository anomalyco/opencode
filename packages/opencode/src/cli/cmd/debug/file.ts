import { File } from "../../../file"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"

const FileReadCommand = cmd({
  command: "read <path>",
  builder: (yargs) =>
    yargs.positional("path", {
      type: "string",
      demandOption: true,
      description: "File path to read",
    }),
  async handler(args) {
    await bootstrap({ cwd: process.cwd() }, async () => {
      const content = await File.read(args.path)
      console.log(content)
    })
  },
})

const FileStatusCommand = cmd({
  command: "status",
  builder: (yargs) => yargs,
  async handler() {
    await bootstrap({ cwd: process.cwd() }, async () => {
      const status = await File.status()
      console.log(JSON.stringify(status, null, 2))
    })
  },
})

export const FileCommand = cmd({
  command: "file",
  builder: (yargs) =>
    yargs.command(FileReadCommand).command(FileStatusCommand).demandCommand(),
  async handler() {},
})
