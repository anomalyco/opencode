import { cmd } from "@/cli/cmd/cmd"
import { Rpc } from "@/util/rpc"
import { type rpc } from "../tui/worker"
import path from "path"
import { fileURLToPath } from "url"
import { UI } from "@/cli/ui"
import { errorMessage } from "@opencode-ai/tui/util/error"
import { withTimeout } from "@/util/timeout"
import { withNetworkOptions, resolveNetworkOptionsNoConfig, hasArg } from "@/cli/network"
import { AppRuntime } from "@/effect/app-runtime"
import { Filesystem } from "@/util/filesystem"
import type { GlobalEvent } from "@opencode-ai/sdk/v2"
import type { EventSource } from "@opencode-ai/tui/context/sdk"
import { writeHeapSnapshot } from "v8"
import { ServerAuth } from "@/server/auth"
import { validateSession } from "../tui/validate-session"
import { win32InstallCtrlCGuard } from "@opencode-ai/tui/terminal-win32"

declare global {
  const OPENCODE_WORKER_PATH: string
}

type RpcClient = ReturnType<typeof Rpc.client<typeof rpc>>
type AutoAttachTarget =
  | { type: "attach"; url: string; headers?: RequestInit["headers"] }
  | { type: "embedded" }
  | { type: "fatal"; message: string }
type AutoAttachFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
type AutoAttachSpawn = (input: { hostname: string; port: number; shutdownAfterLastClient: boolean }) => Promise<void> | void

const AUTO_ATTACH_HEALTH_PATH = "/global/health"
const AUTO_ATTACH_TIMEOUT_MS = 1000
const AUTO_ATTACH_STARTUP_ATTEMPTS = 60
const AUTO_ATTACH_STARTUP_DELAY_MS = 500
const networkOptionNames = ["--port", "--hostname", "--mdns", "--mdns-domain", "--cors"]

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

export function hasExplicitNetworkOptions(argv = process.argv) {
  return argv.some((arg) => networkOptionNames.some((name) => arg === name || arg.startsWith(`${name}=`)))
}

export async function resolveAutoAttachTarget(input: {
  url?: string
  headers?: RequestInit["headers"]
  fetch?: AutoAttachFetch
  spawn?: AutoAttachSpawn
  timeoutMs?: number
  startupAttempts?: number
  startupDelayMs?: number
  argv?: string[]
}): Promise<AutoAttachTarget> {
  if (hasExplicitNetworkOptions(input.argv)) return { type: "embedded" }
  if (input.url === undefined) return { type: "embedded" }

  const attach = input.url.trim()
  if (!attach) return { type: "fatal", message: "server.attach must be a valid URL" }

  let base: URL
  try {
    base = new URL(attach)
  } catch {
    return { type: "fatal", message: "server.attach must be a valid URL" }
  }

  const target = await resolveAutoAttachHealth(attach, base, input)
  if (target.type !== "unreachable") return target

  const local = localAutoAttachServer(base)
  if (!local) return { type: "fatal", message: "server.attach target is unreachable" }

  try {
    await (input.spawn ?? spawnAutoAttachServer)({ ...local, shutdownAfterLastClient: true })
  } catch (error) {
    return { type: "fatal", message: `Failed to start server.attach target: ${errorMessage(error)}` }
  }

  return waitForAutoAttachHealth(attach, base, input)
}

async function resolveAutoAttachHealth(
  attach: string,
  base: URL,
  input: {
    headers?: RequestInit["headers"]
    fetch?: AutoAttachFetch
    timeoutMs?: number
  },
): Promise<AutoAttachTarget | { type: "unreachable" }> {
  const response = await requestAutoAttachHealth(base, input).catch(() => undefined)
  if (response === undefined) return { type: "unreachable" }

  if (response.status === 401 || response.status === 403) {
    return { type: "fatal", message: "server.attach authentication failed" }
  }
  if (!response.ok) {
    return { type: "fatal", message: `server.attach health check failed with HTTP ${response.status}` }
  }

  const body = await response.json().catch(() => undefined)
  if (typeof body !== "object" || body === null || !("healthy" in body) || body.healthy !== true) {
    return { type: "fatal", message: "server.attach target is not a healthy opencode server" }
  }

  return { type: "attach", url: attach, headers: input.headers }
}

async function requestAutoAttachHealth(
  base: URL,
  input: {
    headers?: RequestInit["headers"]
    fetch?: AutoAttachFetch
    timeoutMs?: number
  },
) {
  return (input.fetch ?? fetch)(new URL(AUTO_ATTACH_HEALTH_PATH, base), {
    headers: input.headers,
    signal: AbortSignal.timeout(input.timeoutMs ?? AUTO_ATTACH_TIMEOUT_MS),
  })
}

function localAutoAttachServer(base: URL) {
  const hostname = base.hostname.replace(/^\[|\]$/g, "")
  if (!["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(hostname)) return

  const port = Number(base.port)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return

  return { hostname, port }
}

function spawnAutoAttachServer(input: { hostname: string; port: number; shutdownAfterLastClient: boolean }) {
  const compiled = path.basename(process.execPath).replace(/\.exe$/, "") !== "bun"
  Bun.spawn(
    [
      process.execPath,
      ...(compiled ? [] : [Bun.main]),
      "serve",
      "--hostname",
      input.hostname,
      "--port",
      String(input.port),
      ...(input.shutdownAfterLastClient ? ["--shutdown-after-last-client"] : []),
    ],
    {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    },
  ).unref()
}

async function waitForAutoAttachHealth(
  attach: string,
  base: URL,
  input: {
    headers?: RequestInit["headers"]
    fetch?: AutoAttachFetch
    timeoutMs?: number
    startupAttempts?: number
    startupDelayMs?: number
  },
): Promise<AutoAttachTarget> {
  for (const _ of Array.from({ length: input.startupAttempts ?? AUTO_ATTACH_STARTUP_ATTEMPTS })) {
    await new Promise((resolve) => setTimeout(resolve, input.startupDelayMs ?? AUTO_ATTACH_STARTUP_DELAY_MS))
    const target = await resolveAutoAttachHealth(attach, base, input)
    if (target.type !== "unreachable") return target
  }

  return { type: "fatal", message: "Failed to start server.attach target" }
}

async function globalConfig() {
  const { Config } = await import("@/config/config")
  return AppRuntime.runPromise(Config.Service.use((cfg) => cfg.getGlobal()))
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
      try {
        process.chdir(next)
      } catch {
        UI.error("Failed to change directory to " + next)
        return
      }
      const cwd = Filesystem.resolve(process.cwd())
      const prompt = await input(args.prompt)
      const config = await TuiConfig.get()
      const attach = hasExplicitNetworkOptions()
        ? { type: "embedded" as const }
        : await resolveAutoAttachTarget({
            url: (await globalConfig()).server?.attach,
            headers: ServerAuth.headers(),
          })
      if (attach.type === "fatal") {
        UI.error(attach.message)
        process.exitCode = 1
        return
      }
      if (attach.type === "attach") {
        try {
          await validateSession({
            url: attach.url,
            directory: cwd,
            headers: attach.headers,
            sessionID: args.session,
          })
        } catch (error) {
          UI.error(errorMessage(error))
          process.exitCode = 1
          return
        }

        const { Effect } = await import("effect")
        const { run } = await import("../tui/layer")
        const { createLegacyTuiPluginHost } = await import("@/plugin/tui/runtime")
        await Effect.runPromise(
          run({
            url: attach.url,
            config,
            pluginHost: createLegacyTuiPluginHost(),
            directory: cwd,
            headers: attach.headers,
            args: {
              continue: args.continue,
              sessionID: args.session,
              agent: args.agent,
              model: args.model,
              prompt,
              fork: args.fork,
            },
          }),
        )
        return
      }

      const file = await target()

      const worker = new Worker(file)
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
