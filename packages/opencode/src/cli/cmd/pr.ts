import { UI } from "../ui"
import { cmd } from "./cmd"
import { Instance } from "@/project/instance"
import { $ } from "bun"
import { t } from "../../i18n"

export const PrCommand = cmd({
  command: "pr <number>",
  describe: "fetch and checkout a GitHub PR branch, then run opencode",
  builder: (yargs) =>
    yargs.positional("number", {
      type: "number",
      describe: "PR number to checkout",
      demandOption: true,
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const project = Instance.project
        if (project.vcs !== "git") {
          UI.error(t("pr.no_git_repo"))
          process.exit(1)
        }

        const prNumber = args.number
        const localBranchName = `pr/${prNumber}`
        UI.println(t("pr.fetching", { number: String(prNumber) }))

        // Use gh pr checkout with custom branch name
        const result = await $`gh pr checkout ${prNumber} --branch ${localBranchName} --force`.nothrow()

        if (result.exitCode !== 0) {
          UI.error(t("pr.checkout_failed", { number: String(prNumber) }))
          process.exit(1)
        }

        // Fetch PR info for fork handling and session link detection
        const prInfoResult =
          await $`gh pr view ${prNumber} --json headRepository,headRepositoryOwner,isCrossRepository,headRefName,body`.nothrow()

        let sessionId: string | undefined

        if (prInfoResult.exitCode === 0) {
          const prInfoText = prInfoResult.text()
          if (prInfoText.trim()) {
            const prInfo = JSON.parse(prInfoText)

            // Handle fork PRs
            if (prInfo && prInfo.isCrossRepository && prInfo.headRepository && prInfo.headRepositoryOwner) {
              const forkOwner = prInfo.headRepositoryOwner.login
              const forkName = prInfo.headRepository.name
              const remoteName = forkOwner

              // Check if remote already exists
              const remotes = (await $`git remote`.nothrow().text()).trim()
              if (!remotes.split("\n").includes(remoteName)) {
                await $`git remote add ${remoteName} https://github.com/${forkOwner}/${forkName}.git`.nothrow()
                UI.println(t("pr.added_fork_remote", { name: remoteName }))
              }

              // Set upstream to the fork so pushes go there
              const headRefName = prInfo.headRefName
              await $`git branch --set-upstream-to=${remoteName}/${headRefName} ${localBranchName}`.nothrow()
            }

            // Check for opencode session link in PR body
            if (prInfo && prInfo.body) {
              const sessionMatch = prInfo.body.match(/https:\/\/opncd\.ai\/s\/([a-zA-Z0-9_-]+)/)
              if (sessionMatch) {
                const sessionUrl = sessionMatch[0]
                UI.println(t("pr.found_session", { url: sessionUrl }))
                UI.println(t("pr.importing_session"))

                const importResult = await $`opencode import ${sessionUrl}`.nothrow()
                if (importResult.exitCode === 0) {
                  const importOutput = importResult.text().trim()
                  // Extract session ID from the output (format: "Imported session: <session-id>")
                  const sessionIdMatch = importOutput.match(/Imported session: ([a-zA-Z0-9_-]+)/)
                  if (sessionIdMatch) {
                    sessionId = sessionIdMatch[1]
                    UI.println(t("pr.session_imported", { id: sessionId }))
                  }
                }
              }
            }
          }
        }

        UI.println(t("pr.checkout_success", { number: String(prNumber), branch: localBranchName }))
        UI.println()
        UI.println(t("pr.starting"))
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
      },
    })
  },
})
