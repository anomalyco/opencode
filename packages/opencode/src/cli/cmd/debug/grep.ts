import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"
import { GrepTool } from "../../../tool/grep"

export const GrepCommand = cmd({
  command: "grep <pattern>",
  builder: (yargs) =>
    yargs
      .positional("pattern", {
        type: "string",
        demandOption: true,
        description: "Search pattern",
      })
      .option("path", {
        type: "string",
        description: "Directory to search in",
      })
      .option("include", {
        type: "string",
        description: "File pattern to include (e.g. '*.ts', '*.{ts,tsx}')",
      })
      .option("json", {
        type: "boolean",
        description: "Output raw JSON result",
      }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const params = {
        pattern: args.pattern,
        path: args.path,
        include: args.include,
      }

      try {
        const tool = await GrepTool.init()
        const result = await tool.execute(params, {
          sessionID: "debug",
          messageID: "debug",
          agent: "debug",
          abort: new AbortController().signal,
          metadata: () => {},
        })

        if (args.json) {
          console.log(JSON.stringify(result, null, 2))
        } else {
          console.log(result.output)
          console.log(`\n--- Metadata ---`)
          console.log(`Pattern: ${result.title}`)
          console.log(`Matches: ${result.metadata.matches}`)
          console.log(`Truncated: ${result.metadata.truncated}`)
        }
      } catch (error) {
        console.error("Error:", error instanceof Error ? error.message : error)
        process.exit(1)
      }
    })
  },
})
