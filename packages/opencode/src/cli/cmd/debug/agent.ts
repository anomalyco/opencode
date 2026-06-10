import { Effect } from "effect"
import { effectCmd } from "../../effect-cmd"

export const AgentCommand = effectCmd({
  command: "agent <name>",
  describe: "show agent configuration details",
  builder: (yargs) =>
    yargs
      .positional("name", {
        type: "string",
        demandOption: true,
        description: "Agent name",
      })
      .option("tool", {
        type: "string",
        description: "Tool id to execute",
      })
      .option("params", {
        type: "string",
        description: "Tool params as JSON or a JS object literal",
      }),
  handler: (args) =>
    Effect.gen(function* () {
      const { debugAgent } = yield* Effect.promise(() => import("./agent.handler"))
      return yield* debugAgent(args)
    }),
})
