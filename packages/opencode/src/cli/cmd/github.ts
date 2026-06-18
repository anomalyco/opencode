import { Effect } from "effect"
import { cmd } from "./cmd"
import { effectCmd } from "../effect-cmd"

export { extractResponseText, formatPromptTooLargeError, parseGitHubRemote } from "./github.shared"

export const GithubInstallCommand = effectCmd({
  command: "install",
  describe: "install the GitHub agent",
  handler: () =>
    Effect.gen(function* () {
      const { githubInstall } = yield* Effect.promise(() => import("./github.handler"))
      return yield* githubInstall()
    }),
})

export const GithubRunCommand = effectCmd({
  command: "run",
  describe: "run the GitHub agent",
  builder: (yargs) =>
    yargs
      .option("event", {
        type: "string",
        describe: "GitHub mock event to run the agent for",
      })
      .option("token", {
        type: "string",
        describe: "GitHub personal access token (github_pat_********)",
      }),
  handler: (args) =>
    Effect.gen(function* () {
      const { githubRun } = yield* Effect.promise(() => import("./github.handler"))
      return yield* githubRun(args)
    }),
})

export const GithubCommand = cmd({
  command: "github",
  describe: "manage GitHub agent",
  builder: (yargs) => yargs.command(GithubInstallCommand).command(GithubRunCommand).demandCommand(),
  async handler() {},
})
