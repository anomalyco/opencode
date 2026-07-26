import { cmd } from "@/cli/cmd/cmd"
import { withNetworkOptions } from "@/cli/network"

export const SessionsCommand = cmd({
  command: "sessions [project]",
  describe: "browse sessions across all projects",
  builder: (yargs) =>
    withNetworkOptions(yargs).positional("project", {
      type: "string",
      describe: "path to start opencode in",
    }),
  handler: async (args) => {
    const { runTuiThread } = await import("./tui")
    await runTuiThread({
      ...args,
      initialRoute: { type: "sessions" },
    })
  },
})
