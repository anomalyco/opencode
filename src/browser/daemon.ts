import { BrowserBinary } from "./binary"
import { Log } from "@/util/log"
import { Flag } from "@/flag/flag"
import { Global } from "@/global"
import path from "path"
import fs from "fs/promises"

const log = Log.create({ service: "browser.daemon" })

export interface BrowserDaemonOptions {
  headed?: boolean
  session?: string
  profile?: string
  viewport?: { width: number; height: number }
  userAgent?: string
  idleTimeoutMs?: number
  /**
   * CDP port to connect to an already-running Chrome instance.
   * When set, agent-browser uses --cdp instead of launching its own Chrome.
   * Optional — by default agent-browser launches its own Chrome for Testing.
   */
  cdpPort?: number
}

interface DaemonInstance {
  session: string
  options: BrowserDaemonOptions
  profilePath: string
  cdpPort?: number
  startedAt: number
}

/**
 * Manages the agent-browser daemon lifecycle.
 *
 * Primary mode: agent-browser launches its own Chrome for Testing in
 * headed mode. The Tauri app (Athena Agent UI) is separate — it controls
 * the automation while the user watches Chrome do its thing.
 *
 * Optional CDP mode: connect to an already-running Chrome via
 * --cdp <port> if the user wants to attach to their own browser.
 *
 * In both modes, a persistent profile is used so logins/cookies survive
 * across sessions.
 */
export namespace BrowserDaemon {
  const instances = new Map<string, DaemonInstance>()

  /** Persistent browser profile directory */
  function getProfilePath(): string {
    return path.join(Global.Path.data, "browser-profile")
  }

  /** Resolve CDP port from options → flag → env → undefined */
  function resolveCdpPort(options: BrowserDaemonOptions): number | undefined {
    if (options.cdpPort) return options.cdpPort
    if (Flag.ATHENA_BROWSER_CDP_PORT) return Flag.ATHENA_BROWSER_CDP_PORT
    return undefined
  }

  export async function start(sessionId: string, options: BrowserDaemonOptions = {}): Promise<void> {
    if (instances.has(sessionId)) {
      log.info("daemon already running for session", { sessionId })
      return
    }

    // Ensure persistent profile directory exists
    const profilePath = options.profile || getProfilePath()
    await fs.mkdir(profilePath, { recursive: true })

    const cdpPort = resolveCdpPort(options)

    const optionsWithProfile: BrowserDaemonOptions = {
      ...options,
      profile: profilePath,
      cdpPort,
    }

    const binary = await BrowserBinary.resolve()
    const args = buildGlobalArgs(sessionId, optionsWithProfile)

    const mode = cdpPort ? `CDP:${cdpPort} (Electron)` : "standalone"
    log.info("starting browser daemon", {
      sessionId,
      mode,
      headed: options.headed ?? true,
      profile: profilePath,
    })

    // Set environment for the daemon
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
    }

    if (options.idleTimeoutMs) {
      env["AGENT_BROWSER_IDLE_TIMEOUT_MS"] = String(options.idleTimeoutMs)
    }

    // Start the daemon by opening a blank page
    // In CDP mode this connects to the existing Electron Chromium
    // In standalone mode this launches a new Chrome instance
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
      log.error("failed to start browser daemon", { exitCode, stderr, mode })
      throw new Error(`Failed to start browser daemon (${mode}): ${stderr || "unknown error"}`)
    }

    log.info("browser daemon started", { sessionId, mode, stdout: stdout.slice(0, 200) })

    instances.set(sessionId, {
      session: sessionId,
      options: optionsWithProfile,
      profilePath,
      cdpPort,
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

      // In CDP/Electron mode we close the agent-browser session but
      // do NOT close the actual browser — Electron manages that.
      // We just navigate to about:blank to "release" the tab.
      const closeCmd = instance.cdpPort ? "open" : "close"
      const closeArgs = instance.cdpPort
        ? [binary === "npx" ? "npx" : binary, ...(binary === "npx" ? ["agent-browser"] : []), ...args, "open", "about:blank"]
        : [binary === "npx" ? "npx" : binary, ...(binary === "npx" ? ["agent-browser"] : []), ...args, "close"]

      const proc = Bun.spawn(closeArgs, {
        stdout: "pipe",
        stderr: "pipe",
      })
      await proc.exited
    } catch (e) {
      log.warn("error stopping browser daemon", { sessionId, error: String(e) })
    }

    instances.delete(sessionId)
    // NOTE: We do NOT delete the profile directory — it persists
    // so logins/cookies carry over to the next session
  }

  export function isRunning(sessionId: string): boolean {
    return instances.has(sessionId)
  }

  export function getInfo(sessionId: string): DaemonInstance | undefined {
    return instances.get(sessionId)
  }

  export function isElectronMode(sessionId: string): boolean {
    return instances.get(sessionId)?.cdpPort !== undefined
  }

  export async function stopAll(): Promise<void> {
    const sessions = Array.from(instances.keys())
    await Promise.all(sessions.map((id) => stop(id)))
  }

  export function buildGlobalArgs(sessionId: string, options: BrowserDaemonOptions): string[] {
    const args: string[] = []

    // Session name for isolation between concurrent sessions
    args.push("--session", `athena-${sessionId.slice(0, 8)}`)

    // CDP mode: connect to existing Chromium (Electron) instead of launching Chrome
    if (options.cdpPort) {
      args.push("--cdp", String(options.cdpPort))
    } else {
      // Standalone mode: launch own Chrome
      // Headed mode (default: true for user visibility)
      const headed = options.headed ?? Flag.ATHENA_BROWSER_HEADED
      if (headed) {
        args.push("--headed")
      }
    }

    // JSON output for machine-readable responses
    args.push("--json")

    // Persistent profile — keeps cookies, logins, localStorage across sessions
    if (options.profile) {
      args.push("--profile", options.profile)
    }

    return args
  }
}
