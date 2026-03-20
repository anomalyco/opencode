import { EOL } from "os"
import { Fff } from "../../../file/fff"
import { Instance } from "../../../project/instance"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"
import { Glob } from "@/util/glob"

export const SearchCommand = cmd({
  command: "search",
  describe: "fff search debugging utilities",
  builder: (yargs) => yargs.command(TreeCommand).command(FilesCommand).command(ContentCommand).demandCommand(),
  async handler() {},
})

const TreeCommand = cmd({
  command: "tree",
  describe: "show file tree using fff",
  builder: (yargs) =>
    yargs.option("limit", {
      type: "number",
    }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      process.stdout.write((await Fff.tree({ cwd: Instance.directory, limit: args.limit })) + EOL)
    })
  },
})

const FilesCommand = cmd({
  command: "files",
  describe: "list files using fff",
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
    await bootstrap(process.cwd(), async () => {
      const limit = args.limit ?? 100
      const files = (await Glob.scan("**/*", {
        cwd: Instance.directory,
        include: "file",
        dot: true,
      }))
        .map((x) => x.replaceAll("\\", "/"))
        .filter((x) => Fff.allowed({ rel: x, hidden: true, glob: args.glob ? [args.glob] : undefined }))
        .filter((x) => !args.query || x.includes(args.query))
        .slice(0, limit)
      process.stdout.write(files.join(EOL) + EOL)
    })
  },
})

const ContentCommand = cmd({
  command: "content <pattern>",
  describe: "search file contents using fff",
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
    await bootstrap(process.cwd(), async () => {
      const rows = await Fff.search({
        cwd: Instance.directory,
        pattern: args.pattern,
        glob: args.glob as string[] | undefined,
        limit: args.limit,
      })
      process.stdout.write(JSON.stringify(rows, null, 2) + EOL)
    })
  },
})
