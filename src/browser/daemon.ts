import { BrowserBinary } from "./binary"
import { Log } from "@/util/log"
import { Flag } from "@/flag/flag"

const log = Log.create({ service: "browser.daemon" })

export interface BrowserDaemonOptions {
  headed?: boolean
  session?: string
  profile?: string
  viewport?: { width: number; height: number }
  userAgent?: string
  idleTimeoutMs?: number
}

interface DaemonInstance {
  session: string
  options: BrowserDaemonOptions
  startedAt: number
}

/**
 * Manages the agent-browser daemon lifecycle.
 *
 * agent-browser uses an automatic daemon model: the daemon starts on
 * the first command and persists between commands. We manage this by
 * running an initial `open about:blank` to ensure the daemon is up,
 * and tracking session state.
 */
export namespace BrowserDaemon {
  const instances = new Map<string, DaemonInstance>()

  export async function start(sessionId: string, options: BrowserDaemonOptions = {}): Promise<void> {
    if (instances.has(sessionId)) {
      log.info("daemon already running for session", { sessionId })
      return
    }

    const binary = await BrowserBinary.resolve()
    const args = buildGlobalArgs(sessionId, options)

    log.info("starting browser daemon", { sessionId, headed: options.headed ?? true })

    // Set environment for the daemon
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
    }

    if (options.idleTimeoutMs) {
      env["AGENT_BROWSER_IDLE_TIMEOUT_MS"] = String(options.idleTimeoutMs)
    }

    // Start the daemon by opening a blank page
    const cmdArgs = binary === "npx"
      ? ["npx", "agent-browser", ...args, "open", "about:blank"]
      : [binary, ...args, "open", "about:blank"]

    const proc = Bun.spawn(cmdArgs, {
      stdout: "pipe",
      stderr: "pipe",
      env,
    })

    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited

    if (exitCode !== 0) {
      log.error("failed to start browser daemon", { exitCode, stderr })
      throw new Error(`Failed to start browser daemon: ${stderr || "unknown error"}`)
    }

    log.info("browser daemon started", { sessionId, stdout: stdout.slice(0, 200) })

    instances.set(sessionId, {
      session: sessionId,
      options,
      startedAt: Date.now(),
    })
  }

  export async function stop(sessionId: string): Promise<void> {
    const instance = instances.get(sessionId)
    if (!instance) return

    log.info("stopping browser daemon", { sessionId })

    try {
      const binary = await BrowserBinary.resolve()
      const args = buildGlobalArgs(sessionId, instance.options)

      const cmdArgs = binary === "npx"
        ? ["npx", "agent-browser", ...args, "close"]
        : [binary, ...args, "close"]

      const proc = Bun.spawn(cmdArgs, {
        stdout: "pipe",
        stderr: "pipe",
      })
      await proc.exited
    } catch (e) {
      log.warn("error stopping browser daemon", { sessionId, error: String(e) })
    }

    instances.delete(sessionId)
  }

  export function isRunning(sessionId: string): boolean {
    return instances.has(sessionId)
  }

  export function getInfo(sessionId: string): DaemonInstance | undefined {
    return instances.get(sessionId)
  }

  export async function stopAll(): Promise<void> {
    const sessions = Array.from(instances.keys())
    await Promise.all(sessions.map((id) => stop(id)))
  }

  export function buildGlobalArgs(sessionId: string, options: BrowserDaemonOptions): string[] {
    const args: string[] = []

    // Session name for isolation
    args.push("--session", `athena-${sessionId.slice(0, 8)}`)

    // Headed mode (default: true for user visibility, configurable via flag)
    const headed = options.headed ?? Flag.ATHENA_BROWSER_HEADED
    if (headed) {
      args.push("--headed")
    }

    // JSON output for machine-readable responses
    args.push("--json")

    // Profile for persistent state
    if (options.profile) {
      args.push("--profile", options.profile)
    }

    return args
  }
}
