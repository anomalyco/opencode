import { cmd } from "@/cli/cmd/cmd"
import { Rpc } from "@/util/rpc"
import { type rpc } from "../tui/worker"
import path from "path"
import { fileURLToPath } from "url"
import { UI } from "@/cli/ui"
import { errorMessage } from "@opencode-ai/tui/util/error"
import { withTimeout } from "@/util/timeout"
import { withNetworkOptions, resolveNetworkOptionsNoConfig, hasArg } from "@/cli/network"
import { Filesystem } from "@/util/filesystem"
import type { GlobalEvent } from "@opencode-ai/sdk/v2"
import type { EventSource } from "@opencode-ai/tui/context/sdk"
import { writeHeapSnapshot } from "v8"
import { ServerAuth } from "@/server/auth"
import { validateSession } from "../tui/validate-session"
import { win32InstallCtrlCGuard } from "@opencode-ai/tui/terminal-win32"
import { STARTUP_FRAMES, STARTUP_MESSAGES, STARTUP_FRAME_INTERVAL_MS, STARTUP_MESSAGE_INTERVAL_MS, STARTUP_PROGRESS_BAR_WIDTH, STARTUP_EXPECTED_DURATION_MS, buildProgressBar } from "@opencode-ai/tui/startup-shared"

declare global {
  const OPENCODE_WORKER_PATH: string
  var __opencodeStopPreSplash: (() => void) | undefined
}

type RpcClient = ReturnType<typeof Rpc.client<typeof rpc>>

function createWorkerFetch(client: RpcClient): typeof fetch {
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    const body = request.body ? await request.text() : undefined
    const result = await client.call("fetch", {
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body,
    })
    return new Response(result.body, {
      status: result.status,
      headers: result.headers,
    })
  }
  return fn as typeof fetch
}

function createEventSource(client: RpcClient): EventSource {
  return {
    subscribe: async (handler) => {
      return client.on<GlobalEvent>("global.event", (e) => {
        handler(e)
      })
    },
  }
}

async function target() {
  if (typeof OPENCODE_WORKER_PATH !== "undefined") return OPENCODE_WORKER_PATH
  const dist = new URL("./cli/tui/worker.js", import.meta.url)
  if (await Filesystem.exists(fileURLToPath(dist))) return dist
  return new URL("../tui/worker.ts", import.meta.url)
}

async function input(value?: string) {
  const piped = process.stdin.isTTY ? undefined : await Bun.stdin.text()
  if (!value) return piped
  if (!piped) return value
  return piped + "\n" + value
}

export function resolveThreadDirectory(project?: string, envPWD = process.env.PWD, cwd = process.cwd()) {
  const root = Filesystem.resolve(envPWD ?? cwd)
  if (project) return Filesystem.resolve(path.isAbsolute(project) ? project : path.join(root, project))
  return Filesystem.resolve(cwd)
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
      .option("fork", {
        type: "boolean",
        describe: "fork the session when continuing (use with --continue or --session)",
      })
      .option("prompt", {
        type: "string",
        describe: "prompt to use",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use",
      })
      .option("auto", {
        type: "boolean",
        describe: "auto-approve permissions that are not explicitly denied (dangerous!)",
        default: false,
      })
      .option("yolo", {
        type: "boolean",
        hidden: true,
        default: false,
      })
      .option("dangerously-skip-permissions", {
        type: "boolean",
        hidden: true,
        default: false,
      })
      .option("mini", {
        type: "boolean",
        describe: "start the minimal interactive interface",
        default: false,
      })
      .option("replay", {
        type: "boolean",
        hidden: true,
      })
      .option("no-replay", {
        type: "boolean",
        describe: "disable mini session history replay on resume and after resize",
      })
      .option("replay-limit", {
        type: "number",
        describe: "cap visible mini replay to the newest N messages",
      })
      .option("demo", {
        type: "boolean",
        hidden: true,
      }),
  handler: async (args) => {
    if (args.replay === true) {
      UI.error("--replay is not supported; replay is enabled by default")
      process.exitCode = 1
      return
    }

    // Pre-renderer splash: paint a transient status line to the controlling
    // terminal directly. createCliRenderer will overwrite it as soon as the
    // renderer paints its first frame. We retry on multiple output paths
    // because we do not know which one is actually attached to the user's
    // terminal at this point (stdio could be piped, redirected, or inherited).
    const fs = await import("node:fs")
    const termWidth = process.stdout.columns ?? process.stderr.columns ?? 80
    const termHeight = process.stdout.rows ?? process.stderr.rows ?? 24
    globalThis.__opencodeStartupStartTime = Date.now()
    const startTime = globalThis.__opencodeStartupStartTime
    const centerRow = Math.max(2, Math.floor(termHeight / 2))
    const barRow = centerRow + 2

    const writeRaw = (out: string) => {
      try {
        const tty = fs.openSync("/dev/tty", "w")
        try {
          fs.writeSync(tty, out)
        } finally {
          fs.closeSync(tty)
        }
      } catch {}
      try {
        process.stderr.write(out)
      } catch {}
    }

    // Enter the alt screen buffer so the main screen (with whatever the
    // shell had on it, like `echo hallo`) stays untouched while we render
    // the boot splash. The renderer will also enter the alt screen (a no-op
    // since we are already there) and exit it on shutdown — restoring the
    // main screen exactly as it was.
    writeRaw("\x1b[?1049h\x1b[2J\x1b[?25l\x1b[H")

    let frame = 0
    let phase = 0
    let messageIndex = 0
    let lastMessageChange = Date.now()
    let stopped = false

    const paint = () => {
      if (stopped) return
      const text = `${STARTUP_FRAMES[frame]} ${STARTUP_MESSAGES[messageIndex]}`
      const textCol = Math.max(1, Math.floor((termWidth - text.length) / 2) + 1)

      const elapsed = Date.now() - startTime
      const progress = elapsed / STARTUP_EXPECTED_DURATION_MS
      const { bar, pct } = buildProgressBar(elapsed, phase)
      const barVisualWidth = STARTUP_PROGRESS_BAR_WIDTH + 1 + pct.length
      const barCol = Math.max(1, Math.floor((termWidth - barVisualWidth) / 2) + 1)
      const barColor = progress >= 1 ? "\x1b[38;5;252m" : "\x1b[38;5;240m"

      writeRaw(
        `\x1b[${centerRow};1H\x1b[2K\x1b[${centerRow};${textCol}H` +
        `\x1b[1m\x1b[38;5;252m${text}\x1b[0m` +
        `\x1b[${barRow};1H\x1b[2K\x1b[${barRow};${barCol}H` +
        `${barColor}${bar}\x1b[0m\x1b[38;5;252m ${pct}\x1b[0m`
      )
    }

    paint()

    const preSplashTimer = setInterval(() => {
      if (stopped) return
      frame = (frame + 1) % STARTUP_FRAMES.length
      phase++
      const now = Date.now()
      if (now - lastMessageChange > STARTUP_MESSAGE_INTERVAL_MS) {
        messageIndex = (messageIndex + 1) % STARTUP_MESSAGES.length
        lastMessageChange = now
      }
      paint()
    }, STARTUP_FRAME_INTERVAL_MS)

    const stopPreSplash = () => {
      if (stopped) return
      stopped = true
      clearInterval(preSplashTimer)
      // Nothing to clear on the main screen — the renderer will exit the
      // alt screen on shutdown and restore it as it was before `bun dev`.
    }

    globalThis.__opencodeStopPreSplash = stopPreSplash

    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK", "SIGQUIT"] as const) {
      try {
        process.on(signal, stopPreSplash)
      } catch {}
    }
    try {
      process.on("beforeExit", stopPreSplash)
    } catch {}
    try {
      process.on("exit", stopPreSplash)
    } catch {}
    const noReplay = args.replay === false || args.noReplay === true

    if (args.mini) {
      const network = ["--port", "--hostname", "--mdns", "--no-mdns", "--mdns-domain", "--cors"].find((option) =>
        process.argv.some((arg) => arg === option || arg.startsWith(option + "=")),
      )
      if (network) {
        UI.error(`${network} cannot be used with --mini`)
        process.exitCode = 1
        return
      }

      const { runMini } = await import("./run")
      await runMini({
        directory: resolveThreadDirectory(args.project),
        continue: args.continue,
        session: args.session,
        fork: args.fork,
        model: args.model,
        agent: args.agent,
        prompt: args.prompt,
        replay: noReplay ? false : undefined,
        replayLimit: args.replayLimit,
        demo: args.demo,
      })
      return
    }

    const unsupported = [
      ["--no-replay", noReplay],
      ["--replay-limit", args.replayLimit !== undefined],
      ["--demo", args.demo !== undefined],
    ].find((entry) => entry[1])?.[0]
    if (unsupported) {
      UI.error(`${unsupported} requires --mini`)
      process.exitCode = 1
      return
    }

    const unguard = win32InstallCtrlCGuard()
    try {
      const { TuiConfig } = await import("@/config/tui")
      if (args.fork && !args.continue && !args.session) {
        UI.error("--fork requires --continue or --session")
        process.exitCode = 1
        return
      }

      // Resolve relative --project paths from PWD, then use the real cwd after
      // chdir so the thread and worker share the same directory key.
      const next = resolveThreadDirectory(args.project)
      const file = await target()
      try {
        process.chdir(next)
      } catch {
        UI.error("Failed to change directory to " + next)
        return
      }
      const cwd = Filesystem.resolve(process.cwd())

      const worker = new Worker(file, {
        env: Object.fromEntries(
          Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
        ),
      })
      const client = Rpc.client<typeof rpc>(worker)
      const reload = () => {
        client.call("reload", undefined).catch(() => {})
      }
      process.on("SIGUSR2", reload)

      let stopped = false
      const stop = async () => {
        if (stopped) return
        stopped = true
        process.off("SIGUSR2", reload)
        await withTimeout(client.call("shutdown", undefined), 5000).catch(() => {})
        worker.terminate()
      }

      const prompt = await input(args.prompt)
      const config = await TuiConfig.get()

      const network = resolveNetworkOptionsNoConfig(args)
      const external = hasArg("--port") || hasArg("--hostname") || network.mdns === true

      const headers = external ? ServerAuth.headers() : undefined

      const transport = external
        ? {
            url: (await client.call("server", network)).url,
            fetch: undefined,
            events: undefined,
            headers,
          }
        : {
            url: "http://opencode.internal",
            fetch: createWorkerFetch(client),
            events: createEventSource(client),
          }

      try {
        await validateSession({
          url: transport.url,
          sessionID: args.session,
          directory: cwd,
          fetch: transport.fetch,
          headers,
        })
      } catch (error) {
        UI.error(errorMessage(error))
        process.exitCode = 1
        return
      }

      setTimeout(() => {
        client.call("checkUpgrade", { directory: cwd }).catch(() => {})
      }, 1000).unref?.()

      try {
        const { Effect } = await import("effect")
        const { run } = await import("../tui/layer")
        const { createLegacyTuiPluginHost } = await import("@/plugin/tui/runtime")
        await Effect.runPromise(
          run({
            url: transport.url,
            async onSnapshot() {
              const tui = writeHeapSnapshot("tui.heapsnapshot")
              const server = await client.call("snapshot", undefined)
              return [tui, server]
            },
            config,
            pluginHost: createLegacyTuiPluginHost(),
            directory: cwd,
            fetch: transport.fetch,
            headers: transport.headers,
            events: transport.events,
            args: {
              continue: args.continue,
              sessionID: args.session,
              agent: args.agent,
              model: args.model,
              prompt,
              fork: args.fork,
              auto: args.auto || args.yolo || args["dangerously-skip-permissions"],
            },
          }),
        )
      } finally {
        await stop()
      }
    } finally {
      try {
        unguard?.()
      } catch {}
    }
    process.exit(0)
  },
})
// scratch
