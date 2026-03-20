import { UI } from "../ui"
import { cmd } from "./cmd"
import open from "open"
import path from "path"
import { Filesystem } from "../../util/filesystem"

export const DesktopCommand = cmd({
  command: "desktop [path]",
  describe: "open path in opencode desktop app",
  builder: (yargs) => {
    return yargs.positional("path", {
      describe: "path to open",
      type: "string",
      default: ".",
    })
  },
  handler: async (args) => {
    const targetPath = path.resolve(process.cwd(), args.path)
    if (!(await Filesystem.exists(targetPath))) {
      UI.error(`Path not found: ${targetPath}`)
      process.exit(1)
    }

    const url = `opencode://open-project?directory=${encodeURIComponent(targetPath)}`
    await open(url)
  },
})
