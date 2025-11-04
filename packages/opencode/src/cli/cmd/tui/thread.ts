import { cmd } from "@/cli/cmd/cmd"
import { tui } from "./app"
import { Rpc } from "@/util/rpc"
import { type rpc } from "./worker"
import { Session } from "@/session"
import { bootstrap } from "@/cli/bootstrap"
import path from "path"
import { UI } from "@/cli/ui"
import { Server } from "@/server/server"
import { Instance } from "@/project/instance"

declare global {
  const OPENCODE_WORKER_PATH: string
}

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
      .option("prompt", {
        alias: ["p"],
        type: "string",
        describe: "prompt to use",
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
        type: "string",
        describe: "hostname to listen on",
        default: "127.0.0.1",
      }),
  handler: async (args) => {
    const prompt = await (async () => {
      const piped = !process.stdin.isTTY ? await Bun.stdin.text() : undefined
      if (!args.prompt) return piped
      return piped ? piped + "\n" + args.prompt : args.prompt
    })()

    // Resolve relative paths against PWD to preserve behavior when using --cwd flag
    const baseCwd = process.env.PWD ?? process.cwd()
    const cwd = args.project ? path.resolve(baseCwd, args.project) : process.cwd()
    const defaultWorker = new URL("./worker.ts", import.meta.url)
    // Nix build creates a bundled worker next to the binary; prefer it when present.
    const execDir = path.dirname(process.execPath)
    const bundledWorker = path.join(execDir, "opencode-worker.js")
    const hasBundledWorker = await Bun.file(bundledWorker).exists()
    const workerPath = (() => {
      if (typeof OPENCODE_WORKER_PATH !== "undefined") return OPENCODE_WORKER_PATH
      if (hasBundledWorker) return bundledWorker
      return defaultWorker
    })()
    try {
      process.chdir(cwd)
    } catch (e) {
      UI.error("Failed to change directory to " + cwd)
      return
    }

    await bootstrap(cwd, async () => {
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

      const setup = await (async () => {
        const env = Object.fromEntries(
          Object.entries(process.env).filter(
            (entry): entry is [string, string] => entry[1] !== undefined,
          ),
        )
        const worker = await Promise.resolve()
          .then(
            () =>
              new Worker(workerPath, {
                env,
              }),
          )
          .catch((error) => {
            console.debug("opencode tui worker disabled", error)
            return undefined
          })
        if (worker) {
          worker.onerror = console.error
          const client = Rpc.client<typeof rpc>(worker)
          process.on("uncaughtException", (error) => {
            console.error(error)
          })
          process.on("unhandledRejection", (error) => {
            console.error(error)
          })
          const remote = await client.call("server", {
            port: args.port,
            hostname: args.hostname,
          })
          return {
            url: remote.url,
            stop: async () => {
              await client.call("shutdown", undefined)
              worker.terminate()
            },
          }
        }
        const inline = Server.listen({
          port: args.port ?? 0,
          hostname: args.hostname ?? "127.0.0.1",
        })
        return {
          url: inline.url.toString(),
          stop: async () => {
            await Instance.disposeAll()
            await inline.stop(true)
          },
        }
      })()
      await tui({
        url: setup.url,
        sessionID,
        model: args.model,
        agent: args.agent,
        prompt,
        onExit: async () => {
          await setup.stop()
        },
      })
    })
  },
})
