import { EOL } from "os"
import { File } from "../../../file"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"
import { Ripgrep } from "@/file/ripgrep"

const FileSearchCommand = cmd({
  command: "search <query>",
  describe: "search files by query",
  builder: (yargs) =>
    yargs.positional("query", {
      type: "string",
      demandOption: true,
      description: "Search query",
    }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const results = await File.search({ query: args.query })
      process.stdout.write(results.join(EOL) + EOL)
    })
  },
})

const FileReadCommand = cmd({
  command: "read <path>",
  describe: "read file contents as JSON",
  builder: (yargs) =>
    yargs.positional("path", {
      type: "string",
      demandOption: true,
      description: "File path to read",
    }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const content = await File.read(args.path)
      process.stdout.write(JSON.stringify(content, null, 2) + EOL)
    })
  },
})

const FileStatusCommand = cmd({
  command: "status",
  describe: "show file status information",
  builder: (yargs) => yargs,
  async handler() {
    await bootstrap(process.cwd(), async () => {
      const status = await File.status()
      process.stdout.write(JSON.stringify(status, null, 2) + EOL)
    })
  },
})

const FileListCommand = cmd({
  command: "list <path>",
  describe: "list files in a directory",
  builder: (yargs) =>
    yargs.positional("path", {
      type: "string",
      demandOption: true,
      description: "File path to list",
    }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const files = await File.list(args.path)
      process.stdout.write(JSON.stringify(files, null, 2) + EOL)
    })
  },
})

const FileTreeCommand = cmd({
  command: "tree [dir]",
  describe: "show directory tree",
  builder: (yargs) =>
    yargs.positional("dir", {
      type: "string",
      description: "Directory to tree",
      default: process.cwd(),
    }),
  async handler(args) {
    const files = await Ripgrep.tree({ cwd: args.dir, limit: 200 })
    console.log(JSON.stringify(files, null, 2))
  },
})

export const FileCommand = cmd({
  command: "file",
  describe: "file system debugging utilities",
  builder: (yargs) =>
    yargs
      .command(FileReadCommand)
      .command(FileStatusCommand)
      .command(FileListCommand)
      .command(FileSearchCommand)
      .command(FileTreeCommand)
      .demandCommand(),
  async handler() {},
})
