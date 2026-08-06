import { Effect, Exit } from "effect"
import { UI } from "../ui"
import { effectCmd, fail } from "../effect-cmd"
import { Git } from "@/git"
import { InstanceRef } from "@/effect/instance-ref"
import { Process } from "@/util/process"

type PrInfo = {
  headRepository?: { name: string }
  headRepositoryOwner?: { login: string }
  isCrossRepository?: boolean
  headRefName?: string
  body?: string
}

export const PrCommand = effectCmd({
  command: "pr <number>",
  describe: "fetch and checkout a GitHub PR branch, then run opencode",
  builder: (yargs) =>
    yargs
      .positional("number", {
        type: "number",
        describe: "PR number to checkout",
        demandOption: true,
      })
      .option("no-force", {
        type: "boolean",
        describe: "refuse to discard local changes when checking out",
      })
      .option("no-run", {
        type: "boolean",
        describe: "checkout the PR without launching opencode",
      }),
  handler: Effect.fn("Cli.pr")(function* (args) {
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("Could not load instance context")
    if (ctx.project.vcs !== "git") {
      return yield* fail("Could not find git repository. Please run this command from a git repository.")
    }

    const git = yield* Git.Service
    const worktree = ctx.worktree

    const prNumber = args.number
    const localBranchName = `pr/${prNumber}`

    const auth = yield* Effect.promise(() => Process.run(["gh", "auth", "status"], { nothrow: true }))
    if (auth.code !== 0) {
      return yield* fail("gh CLI is not installed or authenticated. Run `gh auth login` first.")
    }

    UI.println(`Fetching and checking out PR #${prNumber}...`)

    const prInfoResult = yield* Effect.promise(() =>
      Process.text(
        [
          "gh",
          "pr",
          "view",
          `${prNumber}`,
          "--json",
          "headRepository,headRepositoryOwner,isCrossRepository,headRefName,body",
        ],
        { nothrow: true },
      ),
    )
    if (prInfoResult.code !== 0) {
      return yield* fail(`PR #${prNumber} not found or not accessible in this repository.`)
    }

    const checkoutArgs = ["gh", "pr", "checkout", `${prNumber}`, "--branch", localBranchName]
    if (!args["no-force"]) checkoutArgs.push("--force")
    const checkout = yield* Effect.promise(() => Process.run(checkoutArgs, { nothrow: true }))
    if (checkout.code !== 0) {
      return yield* fail(
        `Failed to checkout PR #${prNumber}. Make sure you have gh CLI installed and authenticated.`,
      )
    }

    let sessionId: string | undefined

    if (prInfoResult.text.trim()) {
      let prInfo: PrInfo | undefined
      try {
        prInfo = JSON.parse(prInfoResult.text)
      } catch {
        prInfo = undefined
      }

      if (prInfo?.isCrossRepository && prInfo.headRepository && prInfo.headRepositoryOwner) {
        const forkOwner = prInfo.headRepositoryOwner.login
        const forkName = prInfo.headRepository.name
        const remoteName = forkOwner

        const protocol = yield* Effect.promise(() =>
          Process.text(["gh", "config", "get", "git_protocol"], { nothrow: true }),
        )
        const remoteUrl =
          protocol.code === 0 && protocol.text.trim() === "ssh"
            ? `git@github.com:${forkOwner}/${forkName}.git`
            : `https://github.com/${forkOwner}/${forkName}.git`

        const remotes = (yield* git.run(["remote"], { cwd: worktree })).text().trim()
        const remoteExists = remotes.split("\n").includes(remoteName)
        if (!remoteExists) {
          yield* git.run(["remote", "add", remoteName, remoteUrl], { cwd: worktree })
          UI.println(`Added fork remote: ${remoteName}`)
        }

        const setUpstream = yield* Effect.exit(
          git.run(["branch", `--set-upstream-to=${remoteName}/${prInfo.headRefName}`, localBranchName], {
            cwd: worktree,
          }),
        )
        if (Exit.isFailure(setUpstream)) {
          UI.println(`Warning: could not set upstream for '${localBranchName}'.`)
          if (!remoteExists) {
            yield* git.run(["remote", "remove", remoteName], { cwd: worktree })
            UI.println(`Removed fork remote: ${remoteName}`)
          }
        }
      }

      if (prInfo?.body) {
        const sessionMatch = prInfo.body.match(/https:\/\/opncd\.ai\/s\/([a-zA-Z0-9_-]+)/)
        if (sessionMatch) {
          const sessionUrl = sessionMatch[0]
          UI.println(`Found opencode session: ${sessionUrl}`)
          UI.println(`Importing session...`)

          const importResult = yield* Effect.promise(() =>
            Process.text(["opencode", "import", sessionUrl], { nothrow: true }),
          )
          if (importResult.code === 0) {
            const sessionIdMatch = importResult.text.trim().match(/Imported session: ([a-zA-Z0-9_-]+)/)
            if (sessionIdMatch) {
              sessionId = sessionIdMatch[1]
              UI.println(`Session imported: ${sessionId}`)
            }
          } else {
            UI.println("Warning: failed to import opencode session from PR body.")
          }
        }
      }
    }

    UI.println(`Successfully checked out PR #${prNumber} as branch '${localBranchName}'`)

    if (args["no-run"]) {
      UI.println("Skipping opencode launch (--no-run).")
      return
    }

    UI.println()
    UI.println("Starting opencode...")
    UI.println()

    const opencodeArgs = sessionId ? ["-s", sessionId] : []
    const code = yield* Effect.promise(
      () =>
        Process.spawn(["opencode", ...opencodeArgs], {
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
          cwd: worktree,
        }).exited,
    )
    // Match legacy throw semantics — propagate as a defect so the top-level
    // index.ts catch handles it identically (exit 1, "Unexpected error" banner).
    if (code !== 0) return yield* Effect.die(new Error(`opencode exited with code ${code}`))
  }),
})
