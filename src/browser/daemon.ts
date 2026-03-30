import { BrowserBinary } from "./binary"
import { Log } from "@/util/log"
import { Flag } from "@/flag/flag"
import { Global } from "@/global"
import { PatchrightLauncher } from "./patchright"
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
  cdpPort?: number
}

interface DaemonInstance {
  session: string
  options: BrowserDaemonOptions
  profilePath: string
  cdpPort: number
  startedAt: number
}

/**
 * Manages the browser automation lifecycle.
 *
 * Architecture:
 * 1. Patchright launches Chrome (headed, stealth, persistent profile, CDP enabled)
 * 2. agent-browser connects to that Chrome via --cdp <port>
 * 3. agent-browser is the primary tool interface (AI-optimized @ref snapshots)
 * 4. Patchright is the fallback for edge cases (iframes, shadow DOM, stealth)
 *
 * Chrome lifecycle is owned by Playwright. agent-browser is just a client.
 * On session end, Playwright closes Chrome cleanly.
 */
export namespace BrowserDaemon {
  const instances = new Map<string, DaemonInstance>()

  /** Persistent browser profile directory */
  function getProfilePath(): string {
    return path.join(Global.Path.data, "browser-profile")
  }

  export async function start(sessionId: string, options: BrowserDaemonOptions = {}): Promise<void> {
    if (instances.has(sessionId)) {
      log.info("daemon already running for session", { sessionId })
      return
    }

    const profilePath = options.profile || getProfilePath()
    await fs.mkdir(profilePath, { recursive: true })

    const headed = options.headed ?? Flag.ATHENA_BROWSER_HEADED

    // Step 1: Launch Chrome via Playwright (if not already running)
    const { cdpPort } = await PatchrightLauncher.launch({
      headed,
      profile: profilePath,
      viewport: options.viewport,
    })

    log.info("Chrome launched via Patchright (stealth)", { sessionId, cdpPort, headed })

    // Step 2: Connect agent-browser to that Chrome via CDP
    const optionsWithCdp: BrowserDaemonOptions = {
      ...options,
      profile: profilePath,
      cdpPort,
    }

    const binary = await BrowserBinary.resolve()
    const args = buildGlobalArgs(sessionId, optionsWithCdp)

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
    }

    if (options.idleTimeoutMs) {
      env["AGENT_BROWSER_IDLE_TIMEOUT_MS"] = String(options.idleTimeoutMs)
    }

    // Ping agent-browser to connect to the Patchright-launched Chrome
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
      log.error("agent-browser failed to connect to Chrome", { exitCode, stderr })
      throw new Error(`agent-browser failed to connect to Chrome (CDP:${cdpPort}): ${stderr || "unknown error"}`)
    }

    log.info("agent-browser connected to Playwright Chrome", { sessionId, cdpPort })

    instances.set(sessionId, {
      session: sessionId,
      options: optionsWithCdp,
      profilePath,
      cdpPort,
      startedAt: Date.now(),
    })
  }

  export async function stop(sessionId: string): Promise<void> {
    const instance = instances.get(sessionId)
    if (!instance) return

    log.info("stopping browser session", { sessionId })

    // Navigate agent-browser to blank to release its session
    try {
      const binary = await BrowserBinary.resolve()
      const args = buildGlobalArgs(sessionId, instance.options)
      const cmdArgs = binary === "npx"
        ? ["npx", "agent-browser", ...args, "open", "about:blank"]
        : [binary, ...args, "open", "about:blank"]

      const proc = Bun.spawn(cmdArgs, { stdout: "pipe", stderr: "pipe" })
      const timer = setTimeout(() => { try { proc.kill() } catch {} }, 5000)
      await proc.exited
      clearTimeout(timer)
    } catch (e) {
      log.warn("error releasing agent-browser session", { sessionId, error: String(e) })
    }

    instances.delete(sessionId)

    // If no more sessions, close Chrome via Playwright
    if (instances.size === 0) {
      await PatchrightLauncher.close()
      log.info("Chrome closed (no more sessions)")
    }
  }

  export function isRunning(sessionId: string): boolean {
    return instances.has(sessionId)
  }

  export function getInfo(sessionId: string): DaemonInstance | undefined {
    return instances.get(sessionId)
  }

  export function getCdpPort(sessionId: string): number | undefined {
    return instances.get(sessionId)?.cdpPort
  }

  export async function stopAll(): Promise<void> {
    const sessions = Array.from(instances.keys())
    await Promise.all(sessions.map((id) => stop(id)))
    // Force close Chrome even if individual stops failed
    await PatchrightLauncher.close()
  }

  /**
   * Kill all orphaned processes. Used during process exit as last resort.
   */
  export function killAllOrphans(): void {
    PatchrightLauncher.forceKill()
    try {
      if (process.platform === "win32") {
        Bun.spawn(["taskkill", "/F", "/IM", "agent-browser.exe"], { stdout: "ignore", stderr: "ignore" })
      } else {
        Bun.spawn(["pkill", "-f", "agent-browser"], { stdout: "ignore", stderr: "ignore" })
      }
    } catch {}
  }

  export function buildGlobalArgs(sessionId: string, options: BrowserDaemonOptions): string[] {
    const args: string[] = []

    args.push("--session", `athena-${sessionId.slice(0, 8)}`)

    // Always connect via CDP to the Patchright-launched Chrome
    if (options.cdpPort) {
      args.push("--cdp", String(options.cdpPort))
    }

    args.push("--json")

    if (options.profile) {
      args.push("--profile", options.profile)
    }

    return args
  }
}
