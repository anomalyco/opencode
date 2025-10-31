import { cmd } from "@/cli/cmd/cmd"
import { tui } from "./app"
import { Rpc } from "@/util/rpc"
import { type rpc } from "./worker"
import { upgrade } from "@/cli/upgrade"
import { Session } from "@/session"
import { bootstrap } from "@/cli/bootstrap"
import path from "path"
import { UI } from "@/cli/ui"

export const TuiThreadCommand = cmd({
  command: "$0 [project]",
  describe: "start opencode tui",
  builder: (yargs) =>
    yargs
      .positional("project", {
        type: "string",
        describe: "path to start opencode in",
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session", {
        alias: ["s"],
        describe: "session id to continue",
        type: "string",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use",
      })
      .option("port", {
        type: "number",
        describe: "port to listen on",
        default: 0,
      })
      .option("hostname", {
        alias: ["h"],
        type: "string",
        describe: "hostname to listen on",
        default: "127.0.0.1",
      }),
  handler: async (args) => {
    const cwd = args.project ? path.resolve(args.project) : process.cwd()
    try {
      process.chdir(cwd)
    } catch (e) {
      UI.error("Failed to change directory to " + cwd)
      return
    }
    await bootstrap(cwd, async () => {
      upgrade()

      const sessionID = await (async () => {
        if (args.continue) {
          const it = Session.list()
          try {
            for await (const s of it) {
              if (s.parentID === undefined) {
                return s.id
              }
            }
            return
          } finally {
            await it.return()
          }
        }
        if (args.session) {
          return args.session
        }
        return undefined
      })()

      const worker = new Worker("./src/cli/cmd/tui/worker.ts")
      worker.onerror = console.error
      const client = Rpc.client<typeof rpc>(worker)
      process.on("uncaughtException", (e) => {
        console.error(e)
      })
      process.on("unhandledRejection", (e) => {
        console.error(e)
      })
      const server = await client.call("server", {
        port: args.port,
        hostname: args.hostname,
      })
      await tui({
        url: server.url,
        sessionID,
        model: args.model,
        agent: args.agent,
        onExit: async () => {
          await client.call("shutdown", undefined)
        },
      })
    })
  },
})
