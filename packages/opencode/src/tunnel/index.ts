/**
 * Tunnel Management Module
 *
 * Provides remote access to local OpenCode instances via Cloudflare Tunnel.
 * Also detects Tailscale for alternative connectivity.
 */

import { spawn, execSync, type ChildProcess } from "child_process"
import { Log } from "../util/log"

const log = Log.create({ service: "tunnel" })

let tunnelProcess: ChildProcess | null = null
let tunnelUrl: string | null = null
let tunnelProvider: "cloudflare" | null = null

export interface TunnelStatus {
  enabled: boolean
  url: string | null
  provider: "cloudflare" | null
}

export interface TailscaleInfo {
  ip: string
  hostname: string
}

export namespace Tunnel {
  /**
   * Start a Cloudflare Tunnel to expose the local server.
   * Uses cloudflared's free quick tunnel feature (no account needed).
   *
   * @returns The public tunnel URL
   * @throws If tunnel fails to start or times out
   */
  export async function start(): Promise<string> {
    if (tunnelProcess) {
      log.info("Tunnel already running", { url: tunnelUrl })
      return tunnelUrl!
    }

    const port = process.env.PORT || 4096

    log.info("Starting Cloudflare tunnel", { port })

    return new Promise((resolve, reject) => {
      tunnelProcess = spawn("cloudflared", [
        "tunnel",
        "--url",
        `http://localhost:${port}`,
      ], {
        stdio: ["ignore", "pipe", "pipe"],
      })

      const timeout = setTimeout(() => {
        log.error("Tunnel startup timeout")
        stop()
        reject(new Error("Tunnel startup timeout"))
      }, 30000)

      tunnelProcess.stderr?.on("data", (data: Buffer) => {
        const line = data.toString()
        // Cloudflared outputs the URL to stderr
        const match = line.match(/https:\/\/[^\s]+\.trycloudflare\.com/)
        if (match) {
          clearTimeout(timeout)
          tunnelUrl = match[0]
          tunnelProvider = "cloudflare"
          log.info("Tunnel started", { url: tunnelUrl })
          resolve(tunnelUrl)
        }
      })

      tunnelProcess.stdout?.on("data", (data: Buffer) => {
        log.debug("cloudflared stdout", { data: data.toString() })
      })

      tunnelProcess.on("error", (err) => {
        clearTimeout(timeout)
        log.error("Tunnel process error", { error: err.message })
        tunnelProcess = null
        tunnelUrl = null
        tunnelProvider = null
        reject(new Error(`Failed to start tunnel: ${err.message}`))
      })

      tunnelProcess.on("exit", (code) => {
        log.info("Tunnel process exited", { code })
        tunnelProcess = null
        tunnelUrl = null
        tunnelProvider = null
      })
    })
  }

  /**
   * Stop the running tunnel.
   */
  export async function stop(): Promise<void> {
    if (tunnelProcess) {
      log.info("Stopping tunnel")
      tunnelProcess.kill()
      tunnelProcess = null
      tunnelUrl = null
      tunnelProvider = null
    }
  }

  /**
   * Get the current tunnel status.
   */
  export function getStatus(): TunnelStatus {
    return {
      enabled: !!tunnelProcess,
      url: tunnelUrl,
      provider: tunnelProvider,
    }
  }
}

/**
 * Detect if Tailscale is available and get connection info.
 *
 * @returns Tailscale connection info or null if not available
 */
export async function detectTailscale(): Promise<TailscaleInfo | null> {
  try {
    const ip = execSync("tailscale ip -4", {
      encoding: "utf-8",
      timeout: 5000,
    }).trim()

    if (!ip) return null

    let hostname = ""
    try {
      const status = JSON.parse(
        execSync("tailscale status --json", {
          encoding: "utf-8",
          timeout: 5000,
        })
      )
      hostname = status.Self?.DNSName?.replace(/\.$/, "") || ""
    } catch {
      // Hostname lookup failed, but IP is still useful
    }

    return { ip, hostname }
  } catch {
    return null
  }
}
