/**
 * Sandbox Agent Routes
 *
 * API endpoints for managing the sandbox-agent subprocess.
 * Uses the sandbox-agent npm package to spawn Claude Code, Codex, Amp, or OpenCode
 * via OpenCode-compat API.
 *
 * In local mode (SANDBOX_ENABLED=false), sandbox-agent is auto-started with "opencode"
 * on gateway startup. Switching agents just kills and respawns with the new agent type.
 */

import { Hono } from "hono"
import type { GatewayContext } from "../context.ts"
import { Config } from "../../config/index.ts"
import { startBridge, switchBridge, stopBridge } from "../events/local-bridge.ts"

// Type for the sandbox-agent client instance
interface SandboxAgentClient {
  dispose: () => Promise<void>
  getHealth: () => Promise<{ status: string }>
}

let sandboxClient: SandboxAgentClient | null = null
let sandboxBaseUrl: string | null = null
let sandboxToken: string | null = null
let sandboxAgent: string | null = null

const DEFAULT_PORT = 8080

/**
 * Get the upstream URL of the running sandbox-agent, or null if not running.
 */
export function getSandboxAgentUrl(): string | null {
  return sandboxBaseUrl
}

/**
 * Get the token for authenticating with sandbox-agent, or null if not running.
 */
export function getSandboxAgentToken(): string | null {
  return sandboxToken
}

/**
 * Kill the sandbox-agent subprocess if running.
 */
export async function killSandboxAgent() {
  if (sandboxClient) {
    try {
      await sandboxClient.dispose()
    } catch {}
    sandboxClient = null
    sandboxBaseUrl = null
    sandboxToken = null
    sandboxAgent = null
  }
}

/**
 * Spawn sandbox-agent with the given agent type.
 * Kills any existing instance first.
 * Returns { url, port, agent } on success, throws on failure.
 */
export async function spawnSandboxAgent(
  agent: string,
  env?: Record<string, string>,
): Promise<{ url: string; port: number; agent: string }> {
  await killSandboxAgent()

  const port = Number(process.env.SANDBOX_AGENT_PORT || DEFAULT_PORT)
  const token = process.env.SANDBOX_AGENT_TOKEN || undefined

  const source =
    process.env.SANDBOX_AGENT_MODULE_PATH && process.env.SANDBOX_AGENT_MODULE_PATH.length > 0
      ? process.env.SANDBOX_AGENT_MODULE_PATH
      : "sandbox-agent"
  const { SandboxAgent } = await import(source)

  const client = await SandboxAgent.start({
    spawn: {
      enabled: true,
      host: "127.0.0.1",
      port,
      ...(token ? { token } : {}),
      log: "inherit",
      env: env || {},
    },
  })

  sandboxClient = client
  sandboxBaseUrl = `http://127.0.0.1:${port}`
  sandboxToken = token ?? null
  sandboxAgent = agent

  console.log(`[sandbox-agent] Started ${agent} agent at ${sandboxBaseUrl}`)
  console.log(`[sandbox-agent] Inspector: ${sandboxBaseUrl}/ui/`)

  // Connect event bridge to sandbox-agent's SSE
  if (!Config.SANDBOX_ENABLED) {
    const bridgeHeaders: Record<string, string> = {}
    if (token) bridgeHeaders.authorization = `Bearer ${token}`
    switchBridge(`${sandboxBaseUrl}/opencode`, bridgeHeaders)
  }

  return { url: sandboxBaseUrl, port, agent }
}

export function SandboxAgentRoutes() {
  const app = new Hono<GatewayContext>()

  /**
   * Spawn sandbox-agent subprocess.
   * POST /api/sandbox-agent/spawn
   * Body: { agent?: "claude" | "codex" | "amp" | "opencode", env?: Record<string, string> }
   */
  app.post("/spawn", async (c) => {
    const body = await c.req
      .json<{ agent?: string; env?: Record<string, string> }>()
      .catch(() => ({}) as { agent?: string; env?: Record<string, string> })
    const agent = body.agent || "claude"
    const env = body.env || {}

    try {
      const result = await spawnSandboxAgent(agent, env)
      return c.json(result)
    } catch (err: any) {
      await killSandboxAgent()
      console.error("[sandbox-agent] Failed to start:", err)
      return c.json(
        {
          error: "Failed to spawn sandbox-agent",
          message: err?.message || String(err),
        },
        500,
      )
    }
  })

  /**
   * Stop sandbox-agent subprocess.
   * POST /api/sandbox-agent/stop
   *
   * In local mode, automatically respawns with "opencode" so there's always a backend.
   */
  app.post("/stop", async (c) => {
    const wasRunning = !!sandboxClient
    await killSandboxAgent()
    console.log(`[sandbox-agent] Stopped (was running: ${wasRunning})`)

    // In local mode, restore the backend
    if (!Config.SANDBOX_ENABLED) {
      if (Config.USE_RIVET_SANDBOX_AGENT_SERVER) {
        // Respawn with opencode so the backend stays available
        try {
          await spawnSandboxAgent("opencode")
        } catch (err: any) {
          console.error("[sandbox-agent] Failed to respawn opencode:", err)
          stopBridge()
        }
      } else if (Config.OPENCODE_PORT !== Config.PORT) {
        // Switch event bridge back to local OpenCode server
        switchBridge(`http://127.0.0.1:${Config.OPENCODE_PORT}`)
      }
    }

    return c.json({ success: true })
  })

  /**
   * Get sandbox-agent status.
   * GET /api/sandbox-agent/status
   */
  app.get("/status", (c) => {
    return c.json({
      running: !!sandboxClient,
      agent: sandboxAgent,
      url: getSandboxAgentUrl(),
    })
  })

  return app
}
