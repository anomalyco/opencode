import { cmd } from "./cmd"
import { UI } from "../ui"
import {
  assertSupportedBranch,
  buildDesktop,
  buildTui,
  checkoutAndRebase,
  detectCurrentBranch,
  installDeps,
  pushBranch,
  resolveRepoRoot,
  type SupportedBranch,
} from "../../util/local-dev"

export const UpdateCommand = cmd({
  command: "update [branch]",
  describe: "update local branch on top of upstream dev/beta",
  builder: (yargs) =>
    yargs
      .positional("branch", {
        describe: "target branch",
        choices: ["dev", "beta"] as const,
        type: "string",
      })
      .option("build", {
        describe: "what to rebuild after update",
        choices: ["all", "tui", "desktop", "none"] as const,
        default: "all",
        type: "string",
      }),
  handler: async (args) => {
    const repoRoot = resolveRepoRoot()
    const branch = await resolveBranch(repoRoot, args.branch as SupportedBranch | undefined)
    const buildTarget = args.build as "all" | "tui" | "desktop" | "none"

    UI.println(`Updating '${branch}' branch...`)
    await checkoutAndRebase(repoRoot, branch)
    await pushBranch(repoRoot, branch)

    if (buildTarget === "none") {
      UI.println(`Branch '${branch}' is updated and pushed.`)
      return
    }

    UI.println("Installing dependencies...")
    await installDeps(repoRoot)

    if (buildTarget === "all" || buildTarget === "tui") {
      UI.println("Building TUI binary...")
      await buildTui(repoRoot)
    }

    if ((buildTarget === "all" || buildTarget === "desktop") && process.platform === "linux") {
      UI.println("Building desktop binary...")
      await buildDesktop(repoRoot)
    } else if (buildTarget === "desktop" && process.platform !== "linux") {
      UI.println("Desktop rebuild skipped: desktop build is only supported on Linux.")
    }

    UI.println(`Branch '${branch}' is updated, pushed, and rebuilt (${buildTarget}).`)
  },
})

async function resolveBranch(repoRoot: string, explicit?: SupportedBranch) {
  if (explicit) return explicit

  const current = await detectCurrentBranch(repoRoot)
  assertSupportedBranch(current)
  return current
}
