import { cmd } from "../cmd"

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
    await import("./handler").then(({ handler }) => handler(args))
  },
})

export type PrArgs = Parameters<NonNullable<typeof PrCommand.handler>>[0]
