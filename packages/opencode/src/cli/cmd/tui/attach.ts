import { cmd } from "../cmd"
import { tui } from "./app"

export const AttachCommand = cmd({
  command: "attach <url>",
  describe: "attach to a running opencode server",
  builder: (yargs) =>
    yargs
      .positional("url", {
        type: "string",
        describe: "http://localhost:4096",
        demandOption: true,
      })
      .option("dir", {
        type: "string",
        description: "directory to run in",
      })
      .option("session", {
        alias: ["s"],
        type: "string",
        describe: "session id to continue",
      }),
  handler: async (args) => {
    let directory = args.dir
    if (args.dir) {
      try {
        process.chdir(args.dir)
        directory = process.cwd()
      } catch {
        // If the directory doesn't exist locally (remote attach), pass it through.
      }
    }
    await tui({
      url: args.url,
      args: { sessionID: args.session },
      directory,
    })
  },
})
