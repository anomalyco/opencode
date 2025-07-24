import { App } from "../../../app/app"
import { Ripgrep } from "../../../file/ripgrep"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"

export const RipgrepCommand = cmd({
  command: "rg",
  builder: (yargs) => yargs.command(TreeCommand).command(FilesCommand).command(SearchCommand).demandCommand(),
  async handler() {},
})

const TreeCommand = cmd({
  command: "tree",
  builder: (yargs) =>
    yargs.option("limit", {
      type: "number",
    }),
  async handler(args) {
    await bootstrap({ cwd: process.cwd() }, async () => {
      const app = App.info()
      console.log(await Ripgrep.tree({ cwd: app.path.cwd, limit: args.limit }))
    })
  },
})

const FilesCommand = cmd({
  command: "files",
  builder: (yargs) =>
    yargs
      .option("query", {
        type: "string",
        description: "Filter files by query",
      })
      .option("glob", {
        type: "string",
        description: "Glob pattern to match files",
      })
      .option("limit", {
        type: "number",
        description: "Limit number of results",
      }),
  async handler(args) {
    await bootstrap({ cwd: process.cwd() }, async () => {
      const app = App.info()
      const files = await Ripgrep.files({
        cwd: app.path.cwd,
        query: args.query,
        glob: args.glob ? [args.glob] : undefined,
        limit: args.limit,
      })
      console.log(files.join("\n"))
    })
  },
})

const SearchCommand = cmd({
  command: "search <pattern>",
  builder: (yargs) =>
    yargs
      .positional("pattern", {
        type: "string",
        demandOption: true,
        description: "Search pattern",
      })
      .option("glob", {
        type: "array",
        description: "File glob patterns",
      })
      .option("limit", {
        type: "number",
        description: "Limit number of results",
      }),
  async handler(args) {
    const results = await Ripgrep.search({
      cwd: process.cwd(),
      pattern: args.pattern,
      glob: args.glob as string[] | undefined,
      limit: args.limit,
    })
    console.log(JSON.stringify(results, null, 2))
  },
})
