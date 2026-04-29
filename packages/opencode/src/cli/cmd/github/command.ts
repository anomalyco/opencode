import { cmd } from "../cmd"

const GithubInstallCommand = cmd({
  command: "install",
  describe: "install the GitHub agent",
  async handler() {
    await import("./handler").then(({ installHandler }) => installHandler())
  },
})

const GithubRunCommand = cmd({
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
  async handler(args) {
    await import("./handler").then(({ runHandler }) => runHandler(args))
  },
})

export const GithubCommand = cmd({
  command: "github",
  describe: "manage GitHub agent",
  builder: (yargs) => yargs.command(GithubInstallCommand).command(GithubRunCommand).demandCommand(),
  async handler() {},
})
