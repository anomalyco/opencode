import { cmd } from "../cmd"
import { tui } from "./app"
import { parseAttachUrl } from "./parse-url"

export const AttachCommand = cmd({
  command: "attach <url>",
  describe: "attach to a running opencode server",
  builder: (yargs) =>
    yargs
      .positional("url", {
        type: "string",
        describe: "Server URL: http://localhost:4096 or unix:///path/to/socket",
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
    if (args.dir) process.chdir(args.dir)

    let parsed
    try {
      parsed = parseAttachUrl(args.url)
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : error}`)
      process.exit(1)
    }

    await tui({
      url: parsed.baseUrl,
      args: { sessionID: args.session },
      directory: args.dir ? process.cwd() : undefined,
      unix: parsed.unix,
    })
  },
})
