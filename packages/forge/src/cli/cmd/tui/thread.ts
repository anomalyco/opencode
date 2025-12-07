import { cmd } from "@/cli/cmd/cmd"
import { tui } from "./app"
import { Rpc } from "@/util/rpc"
import { type rpc } from "./worker"
import path from "path"
import { UI } from "@/cli/ui"
import { iife } from "@/util/iife"
import { Log } from "@/util/log"
import { runNonInteractive, type RunHandlerArgs } from "../run"

declare global {
  const FORGE_WORKER_PATH: string
}

export const TuiThreadCommand = cmd({
  command: "$0 [prompt]",
  describe: "start forge tui",
  builder: (yargs) =>
    yargs
      .positional("prompt", {
        type: "string",
        describe: "prompt to send",
      })
      .option("project", {
        type: "string",
        describe: "path to start forge in",
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session", {
        alias: ["s"],
        type: "string",
        describe: "session id to continue",
      })
      .option("print", {
        alias: ["p"],
        type: "boolean",
        describe: "Print response and exit",
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
      })
      .option("command", {
        type: "string",
        describe: "the command to run, use prompt for args (print mode only)",
      })
      .option("file", {
        alias: ["f"],
        type: "string",
        array: true,
        describe: "file(s) to attach to prompt (print mode only)",
      })
      .option("share", {
        type: "boolean",
        describe: "share the session (print mode only)",
      })
      .option("title", {
        type: "string",
        describe: "title for the session (print mode only, uses truncated prompt if empty string)",
      })
      .option("attach", {
        type: "string",
        describe: "attach to a running forge server (e.g., http://localhost:4096) (print mode only)",
      })
      .option("format", {
        type: "string",
        choices: ["default", "json"] as const,
        default: "default",
        describe: "output format for print mode",
      }),
  handler: async (args: any) => {
    const baseCwd = process.env.PWD ?? process.cwd()
    const cwd = args.project ? path.resolve(baseCwd, args.project) : process.cwd()
    const defaultWorker = new URL("./worker.ts", import.meta.url)
    // Nix build creates a bundled worker next to the binary; prefer it when present.
    const execDir = path.dirname(process.execPath)
    const bundledWorker = path.join(execDir, "opencode-worker.js")
    const hasBundledWorker = await Bun.file(bundledWorker).exists()
    const workerPath = (() => {
      if (typeof FORGE_WORKER_PATH !== "undefined") return FORGE_WORKER_PATH
      if (hasBundledWorker) return bundledWorker
      return defaultWorker
    })()
    try {
      process.chdir(cwd)
    } catch (e) {
      UI.error("Failed to change directory to " + cwd)
      return
    }

    if (args.command && !args.print) {
      UI.error("--command is only supported with --print")
      process.exit(1)
    }

    if (args.print) {
      const promptText = args.prompt

      const runArgs: RunHandlerArgs = {
        message: promptText,
        command: args.command,
        continue: args.continue,
        session: args.session,
        share: args.share,
        agent: args.agent,
        "plan-agent": args["plan-agent"],
        file: args.file,
        title: args.title,
        attach: args.attach,
        port: args.port,
        format: args.format as RunHandlerArgs["format"],
      }

      await runNonInteractive(runArgs)
      return
    }

    const worker = new Worker(workerPath, {
      env: Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
      ),
      argv: [
        ...(args.agent ? ["--agent", args.agent] : []),
        ...(args["plan-agent"] ? ["--plan-agent", args["plan-agent"]] : []),
      ],
    })
    worker.onerror = (e) => {
      Log.Default.error(e)
    }
    const client = Rpc.client<typeof rpc>(worker)
    process.on("uncaughtException", (e) => {
      Log.Default.error(e)
    })
    process.on("unhandledRejection", (e) => {
      Log.Default.error(e)
    })
    const server = await client.call("server", {
      port: args.port,
      hostname: args.hostname,
    })
    const prompt = await iife(async () => {
      const piped = !process.stdin.isTTY ? await Bun.stdin.text() : undefined
      if (!args.prompt) return piped
      return piped ? piped + "\n" + args.prompt : args.prompt
    })
    await tui({
      url: server.url,
      args: {
        continue: args.continue,
        sessionID: args.session,
        agent: args.agent,
        prompt,
      },
      onExit: async () => {
        await client.call("shutdown", undefined)
      },
    })
  },
})
