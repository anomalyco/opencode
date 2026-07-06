import { ServerProcess } from "@opencode-ai/cli/server-process"
import { Effect } from "effect"
import { cmd } from "./cmd"

export const V2ServeCommand = cmd({
  command: "__v2-serve",
  describe: false,
  builder: (yargs) =>
    yargs
      .option("stdio", { type: "boolean", hidden: true })
      .option("port", { type: "number", hidden: true }),
  handler: async (args) => {
    const controller = new AbortController()
    const interrupt = () => controller.abort()
    process.once("SIGINT", interrupt)
    process.once("SIGTERM", interrupt)
    process.once("SIGHUP", interrupt)
    try {
      await Effect.runPromise(
        ServerProcess.run({ mode: args.stdio ? "stdio" : "service", port: args.port }),
        { signal: controller.signal },
      )
    } catch (error) {
      if (!controller.signal.aborted) throw error
    } finally {
      process.off("SIGINT", interrupt)
      process.off("SIGTERM", interrupt)
      process.off("SIGHUP", interrupt)
    }
  },
})
