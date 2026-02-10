import { cmd } from "./cmd"
import { UI } from "../ui"
import { buildDesktop, findDesktopBinary, resolveRepoRoot } from "../../util/local-dev"

export const DesktopCommand = cmd({
  command: "desktop [args..]",
  describe: "launch local opencode desktop app",
  builder: (yargs) =>
    yargs.positional("args", {
      describe: "arguments passed to desktop app",
      type: "string",
      array: true,
      default: [],
    }),
  handler: async (args) => {
    const repoRoot = resolveRepoRoot()

    let binary = await findDesktopBinary(repoRoot)
    if (!binary) {
      UI.println("Desktop binary not found, building desktop...")
      await buildDesktop(repoRoot)
      binary = await findDesktopBinary(repoRoot)
    }

    if (!binary) {
      throw new Error("Desktop binary was not found after build.")
    }

    const child = Bun.spawn({
      cmd: [binary, ...((args.args as string[] | undefined) ?? [])],
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    })

    const code = await child.exited
    process.exit(code)
  },
})
