import { cmd } from "./cmd"
import { UI } from "../ui"
import { buildDesktop, buildTui, installDeps, resolveRepoRoot } from "../../util/local-dev"

type BuildTarget = "tui" | "desktop"

export const BuildCommand = cmd({
  command: "build [target]",
  describe: "build local opencode binaries",
  builder: (yargs) =>
    yargs.positional("target", {
      describe: "what to build",
      choices: ["tui", "desktop"] as const,
      type: "string",
    }),
  handler: async (args) => {
    const repoRoot = resolveRepoRoot()
    const target = args.target as BuildTarget | undefined

    await installDeps(repoRoot)

    if (!target || target === "tui") {
      UI.println("Building TUI binary...")
      await buildTui(repoRoot)
    }

    if (!target || target === "desktop") {
      UI.println("Building desktop binary...")
      const rustTarget = await buildDesktop(repoRoot)
      UI.println(`Desktop target built: ${rustTarget}`)
    }

    UI.println("Build completed")
  },
})
