import { cmd } from "@/cli/cmd/cmd"
import { tui } from "./app"
import path from "path"
import { UI } from "@/cli/ui"
import { iife } from "@/util/iife"
import { Log } from "@/util/log"
import { withNetworkOptions, resolveNetworkOptions } from "@/cli/network"
import type { Event } from "@opencode-ai/sdk/v2"
import type { EventSource } from "./context/sdk"
import { win32DisableProcessedInput, win32InstallCtrlCGuard } from "./win32"
import { Installation } from "@/installation"
import { Rpc } from "@/util/rpc"
import type { WorkerRpc } from "./worker"

declare const OPENCODE_WORKER_PATH: string | undefined

function createWorkerFetch(client: ReturnType<typeof Rpc.client<WorkerRpc>>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    const result = await client.call("fetch", {
      url: url.pathname + url.search,
      init: {
        method: request.method,
        headers: Object.fromEntries(request.headers),
        body: request.body ? await request.text() : undefined,
      },
    })
    return new Response(result.body ?? null, {
      status: result.status,
      headers: result.headers,
    })
  }) as typeof fetch
}

function createEventSource(client: ReturnType<typeof Rpc.client<WorkerRpc>>): EventSource {
  const handlers = new Set<(event: Event) => void>()
  const dispatch = (event: Event) => {
    for (const handler of handlers) handler(event)
  }
  client.on("event", dispatch)
  client.on("global.event", dispatch)
  return {
    on: (handler) => {
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    },
  }
}

export const TuiThreadCommand = cmd({
  command: "$0 [project]",
  describe: "start opencode tui",
  builder: (yargs) =>
    withNetworkOptions(yargs)
      .positional("project", { type: "string", describe: "path to start opencode in" })
      .option("model", { type: "string", alias: ["m"], describe: "model to use in the format of provider/model" })
      .option("continue", { alias: ["c"], describe: "continue the last session", type: "boolean" })
      .option("session", { alias: ["s"], type: "string", describe: "session id to continue" })
      .option("fork", {
        type: "boolean",
        describe: "fork the session when continuing (use with --continue or --session)",
      })
      .option("prompt", { type: "string", describe: "prompt to use" })
      .option("agent", { type: "string", describe: "agent to use" }),
  handler: async (args) => {
    const unguard = win32InstallCtrlCGuard()
    try {
      win32DisableProcessedInput()

      if (args.fork && !args.continue && !args.session) {
        UI.error("--fork requires --continue or --session")
        process.exitCode = 1
        return
      }
      const baseCwd = process.env.PWD ?? process.cwd()
      const cwd = args.project ? path.resolve(baseCwd, args.project) : process.cwd()
      try {
        process.chdir(cwd)
      } catch {
        UI.error("Failed to change directory to " + cwd)
        return
      }

      await Log.init({
        print: process.argv.includes("--print-logs"),
        dev: Installation.isLocal(),
        level: Installation.isLocal() ? "DEBUG" : "INFO",
      })

      Log.Default.info("opencode starting", { pid: process.pid })

      process.on("uncaughtException", (e) => {
        Log.Default.error(e)
      })
      process.on("unhandledRejection", (e) => {
        Log.Default.error(e)
      })

      const prompt = await iife(async () => {
        const piped = !process.stdin.isTTY ? await Bun.stdin.text() : undefined
        if (!args.prompt) return piped
        return piped ? piped + "\n" + args.prompt : args.prompt
      })

      const networkOpts = await resolveNetworkOptions(args)
      const shouldStartServer =
        process.argv.includes("--port") ||
        process.argv.includes("--hostname") ||
        process.argv.includes("--mdns") ||
        networkOpts.mdns ||
        networkOpts.port !== 0 ||
        networkOpts.hostname !== "127.0.0.1"

      const workerPath =
        typeof OPENCODE_WORKER_PATH === "string"
          ? OPENCODE_WORKER_PATH
          : path.resolve(import.meta.dirname, Installation.isLocal() ? "worker.ts" : "worker.js")

      // Spawn worker thread — all server/agent/DB operations run there
      const worker = new Worker(workerPath)
      worker.onerror = (e) => console.error("worker error", e)
      const transport = Rpc.worker(worker)
      const client = Rpc.client<WorkerRpc>(transport)

      let url: string
      let customFetch: typeof fetch | undefined
      let events: EventSource | undefined

      if (shouldStartServer) {
        const result = await client.call("server", {
          directory: cwd,
          port: networkOpts.port,
          hostname: networkOpts.hostname,
          mdns: networkOpts.mdns,
        })
        url = result ?? `http://${networkOpts.hostname}:${networkOpts.port}`
      } else {
        // Start event stream but don't listen on a port
        await client.call("server", { directory: cwd })
        url = "http://opencode.internal"
        customFetch = createWorkerFetch(client)
        events = createEventSource(client)
      }

      const tuiPromise = tui({
        url,
        fetch: customFetch,
        events,
        args: {
          continue: args.continue,
          sessionID: args.session,
          agent: args.agent,
          model: args.model,
          prompt,
          fork: args.fork,
        },
        onExit: async () => {
          await client.call("shutdown", {})
          worker.terminate()
        },
      })

      // Check for upgrades in background
      setTimeout(() => {
        client.call("checkUpgrade", { directory: cwd }).catch(() => {})
      }, 1000)

      await tuiPromise
    } finally {
      unguard?.()
    }
    process.exit(0)
  },
})
