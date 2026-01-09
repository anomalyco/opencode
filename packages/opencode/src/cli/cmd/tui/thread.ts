import { cmd } from "@/cli/cmd/cmd"
import { tui } from "./app"
import { Rpc } from "@/util/rpc"
import { type rpc } from "./worker"
import path from "path"
import { UI } from "@/cli/ui"
import { iife } from "@/util/iife"
import { Log } from "@/util/log"
import { withNetworkOptions, resolveNetworkOptions } from "@/cli/network"
import { existsSync } from "fs"

type PaneSource = "option" | "positional"

const PANE_COUNTS = new Set([2, 4, 6])

function parsePaneCount(value: string | number | undefined): number | null {
  if (value === undefined || value === null) return null
  const count = typeof value === "number" ? value : Number(value)
  if (!Number.isInteger(count)) return null
  return PANE_COUNTS.has(count) ? count : null
}

function buildChildArgs(
  rawArgs: string[],
  paneCount: number,
  paneSource: PaneSource,
): string[] {
  const result: string[] = []
  let removedPositional = false
  let skipNext = false
  let seenDoubleDash = false
  const paneString = String(paneCount)

  for (const arg of rawArgs) {
    if (skipNext) {
      skipNext = false
      continue
    }
    if (arg === "--") {
      seenDoubleDash = true
      result.push(arg)
      continue
    }
    if (!seenDoubleDash && paneSource === "option") {
      if (arg === "--panes") {
        skipNext = true
        continue
      }
      if (arg.startsWith("--panes=")) {
        continue
      }
    }
    if (!seenDoubleDash && paneSource === "positional" && !removedPositional && !arg.startsWith("-") && arg === paneString) {
      removedPositional = true
      continue
    }
    result.push(arg)
  }

  return result
}

function buildSplitCommand(
  direction: "V" | "H",
  size: string,
  cwd: string,
  profileId: string | undefined,
  childArgs: string[],
): string[] {
  const args = ["split-pane", `-${direction}`, "--size", size]
  if (profileId) args.push("-p", profileId)
  args.push("-d", cwd, "opencode", ...childArgs)
  return args
}

function buildPaneLayout(
  paneCount: number,
  cwd: string,
  profileId: string | undefined,
  childArgs: string[],
): string[] | null {
  const splitV33 = buildSplitCommand("V", "0.33", cwd, profileId, childArgs)
  const splitV50 = buildSplitCommand("V", "0.5", cwd, profileId, childArgs)
  const splitH50 = buildSplitCommand("H", "0.5", cwd, profileId, childArgs)

  if (paneCount === 2) {
    return ["-w", "0", ...splitV50]
  }
  if (paneCount === 4) {
    return [
      "-w",
      "0",
      ...splitV50,
      ";",
      "move-focus",
      "left",
      ";",
      ...splitH50,
      ";",
      "move-focus",
      "right",
      ";",
      ...splitH50,
    ]
  }
  if (paneCount === 6) {
    return [
      "-w",
      "0",
      ...splitV33,
      ";",
      ...splitV50,
      ";",
      ...splitH50,
      ";",
      "move-focus",
      "left",
      ";",
      ...splitH50,
      ";",
      "move-focus",
      "left",
      ";",
      ...splitH50,
    ]
  }
  return null
}

function splitWindowsTerminalPanes(
  paneCount: number,
  cwd: string,
  childArgs: string[],
): boolean {
  if (process.platform !== "win32") return false
  if (!process.env.WT_SESSION) return false
  const wt = Bun.which("wt") ?? Bun.which("wt.exe")
  if (!wt) return false

  const profileId = process.env.WT_PROFILE_ID
  const layout = buildPaneLayout(paneCount, cwd, profileId, childArgs)
  if (!layout) return false

  try {
    Bun.spawn({
      cmd: [wt, ...layout],
      stdout: "ignore",
      stderr: "ignore",
    })
    return true
  } catch {
    return false
  }
}

declare global {
  const OPENCODE_WORKER_PATH: string
}

export const TuiThreadCommand = cmd({
  command: "$0 [project]",
  describe: "start opencode tui",
  builder: (yargs) =>
    withNetworkOptions(yargs)
      .positional("project", {
        type: "string",
        describe: "path to start opencode in",
      })
      .option("panes", {
        type: "number",
        describe: "open multiple Windows Terminal panes (2, 4, 6)",
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
        type: "string",
        describe: "session id to continue",
      })
      .option("prompt", {
        type: "string",
        describe: "prompt to use",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use",
      }),
  handler: async (args) => {
    // Resolve relative paths against PWD to preserve behavior when using --cwd flag
    const baseCwd = process.env.PWD ?? process.cwd()
    const rawArgs = process.argv.slice(2)
    const paneFromOption = parsePaneCount(args.panes)
    let paneCount = paneFromOption
    let paneSource: PaneSource | null = paneFromOption ? "option" : null
    let projectArg = args.project
    if (!paneCount) {
      const fromProject = parsePaneCount(args.project)
      if (fromProject) {
        const candidate = path.resolve(baseCwd, String(args.project))
        if (!existsSync(candidate)) {
          paneCount = fromProject
          paneSource = "positional"
          projectArg = undefined
        }
      }
    }
    const cwd = projectArg ? path.resolve(baseCwd, projectArg) : process.cwd()
    const localWorker = new URL("./worker.ts", import.meta.url)
    const distWorker = new URL("./cli/cmd/tui/worker.js", import.meta.url)
    const workerPath = await iife(async () => {
      if (typeof OPENCODE_WORKER_PATH !== "undefined") return OPENCODE_WORKER_PATH
      if (await Bun.file(distWorker).exists()) return distWorker
      return localWorker
    })
    if (paneCount && paneSource) {
      const childArgs = buildChildArgs(rawArgs, paneCount, paneSource)
      splitWindowsTerminalPanes(paneCount, cwd, childArgs)
    }

    try {
      process.chdir(cwd)
    } catch (e) {
      UI.error("Failed to change directory to " + cwd)
      return
    }

    const worker = new Worker(workerPath, {
      env: Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
      ),
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
    process.on("SIGUSR2", async () => {
      await client.call("reload", undefined)
    })
    const opts = await resolveNetworkOptions(args)
    const server = await client.call("server", opts)
    const prompt = await iife(async () => {
      const piped = !process.stdin.isTTY ? await Bun.stdin.text() : undefined
      if (!args.prompt) return piped
      return piped ? piped + "\n" + args.prompt : args.prompt
    })

    const tuiPromise = tui({
      url: server.url,
      args: {
        continue: args.continue,
        sessionID: args.session,
        agent: args.agent,
        model: args.model,
        prompt,
      },
      onExit: async () => {
        await client.call("shutdown", undefined)
      },
    })

    setTimeout(() => {
      client.call("checkUpgrade", { directory: cwd }).catch(() => {})
    }, 1000)

    await tuiPromise
  },
})
