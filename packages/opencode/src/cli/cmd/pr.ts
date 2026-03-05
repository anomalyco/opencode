import { UI } from "../ui"
import { cmd } from "./cmd"
import { Instance } from "@/project/instance"
import { $ } from "bun"
import { VCSManager } from "../../vcs/manager"
import { Flag } from "../../flag/flag"

export const PrCommand = cmd({
  command: "pr",
  describe: "list or checkout a GitLab MR branch",
  builder: (yargs) =>
    yargs
      .option("id", {
        type: "number",
        describe: "MR IID to checkout",
        alias: "i",
      })
      .option("project", {
        type: "number",
        describe: "GitLab project ID",
        alias: "p",
      }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const project = Instance.project
        if (project.vcs !== "git") {
          UI.error("Could not find git repository. Please run this command from a git repository.")
          process.exit(1)
        }

        // Get projectId from flag or environment variable
        const projectId = args.project
          ? String(args.project)
          : Flag.OPENSACIA_GITLAB_PROJECT_ID || "61"

        const mrIid = args.id as number | undefined

        // Initialize VCS manager
        const manager = new VCSManager({ provider: "gitlab" })
        await manager.initialize()

        // If no MR ID provided, list open MRs
        if (!mrIid) {
          await listMRs(manager, projectId)
          return
        }

        // Checkout the specified MR
        await checkoutMR(manager, projectId, mrIid)
      },
    })
  },
})

async function listMRs(manager: VCSManager, projectId: string): Promise<void> {
  UI.println(`Fetching open merge requests for project ${projectId}...`)
  UI.println()

  try {
    const mrs = await manager.listMRs(projectId, { state: "opened" })

    if (mrs.length === 0) {
      UI.println("No open merge requests found.")
      return
    }

    UI.println(`Found ${mrs.length} open merge request(s):`)
    UI.println()

    for (const mr of mrs) {
      UI.println(`!${mr.iid} - ${mr.title}`)
      UI.println(`  Author: ${mr.author.login}`)
      UI.println(`  Branch: ${mr.sourceBranch} -> ${mr.targetBranch}`)
      UI.println(`  URL: ${mr.webUrl}`)
      UI.println()
    }

    UI.println("To checkout an MR, use:")
    UI.println(`  opencode pr --project ${projectId} --id <MR_IID>`)
  } catch (error) {
    UI.error(`Failed to fetch merge requests: ${error}`)
    process.exit(1)
  }
}

async function checkoutMR(
  manager: VCSManager,
  projectId: string,
  mrIid: number
): Promise<void> {
  UI.println(`Fetching MR !${mrIid} from project ${projectId}...`)

  try {
    const mr = await manager.getMR(projectId, mrIid)
    const branch = mr.sourceBranch

    UI.println(`MR: ${mr.title}`)
    UI.println(`Branch: ${branch} -> ${mr.targetBranch}`)
    UI.println(`Author: ${mr.author.login}`)
    UI.println()

    // Fetch the branch from origin
    UI.println(`Fetching branch ${branch} from origin...`)
    const fetchResult = await $`git fetch origin ${branch}`.nothrow()

    if (fetchResult.exitCode !== 0) {
      UI.error(`Failed to fetch branch ${branch}`)
      UI.error(fetchResult.stderr.toString())
      process.exit(1)
    }

    // Checkout the branch
    UI.println(`Checking out branch ${branch}...`)
    const checkoutResult = await $`git checkout ${branch}`.nothrow()

    if (checkoutResult.exitCode !== 0) {
      UI.error(`Failed to checkout branch ${branch}`)
      UI.error(checkoutResult.stderr.toString())
      process.exit(1)
    }

    UI.println()
    UI.println(`Successfully checked out MR !${mrIid} as branch '${branch}'`)

    // Check for opencode session link in MR description
    let sessionId: string | undefined
    if (mr.description) {
      const sessionMatch = mr.description.match(/https:\/\/opncd\.ai\/s\/([a-zA-Z0-9_-]+)/)
      if (sessionMatch) {
        const sessionUrl = sessionMatch[0]
        UI.println()
        UI.println(`Found opencode session: ${sessionUrl}`)
        UI.println(`Importing session...`)

        const importResult = await $`opencode import ${sessionUrl}`.nothrow()
        if (importResult.exitCode === 0) {
          const importOutput = importResult.text().trim()
          // Extract session ID from the output (format: "Imported session: <session-id>")
          const sessionIdMatch = importOutput.match(/Imported session: ([a-zA-Z0-9_-]+)/)
          if (sessionIdMatch) {
            sessionId = sessionIdMatch[1]
            UI.println(`Session imported: ${sessionId}`)
          }
        }
      }
    }

    UI.println()
    UI.println("Starting opencode...")
    UI.println()

    // Launch opencode TUI with session ID if available
    const { spawn } = await import("child_process")
    const opencodeArgs = sessionId ? ["-s", sessionId] : []
    const opencodeProcess = spawn("opencode", opencodeArgs, {
      stdio: "inherit",
      cwd: process.cwd(),
    })

    await new Promise<void>((resolve, reject) => {
      opencodeProcess.on("exit", (code) => {
        if (code === 0) resolve()
        else reject(new Error(`opencode exited with code ${code}`))
      })
      opencodeProcess.on("error", reject)
    })
  } catch (error) {
    UI.error(`Failed to fetch MR !${mrIid}: ${error}`)
    process.exit(1)
  }
}
