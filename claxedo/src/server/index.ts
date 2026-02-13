/**
 * Claxedo Gateway Server Entry Point
 */
import { createServer, type IncomingMessage } from "node:http"
import { getRequestListener } from "@hono/node-server"
import { App } from "./app.ts"
import { createPtyWebSocketServer, handlePtyUpgrade } from "./proxy/websocket.ts"
import { Config } from "../config/index.ts"
import { initOrchestrator } from "../orchestrator/index.ts"
import { initObservability, shutdownObservability } from "../observability/index.ts"
import { killSandboxAgent, spawnSandboxAgent } from "./routes/sandbox-agent.ts"
import { startBridge, stopBridge } from "./events/local-bridge.ts"

// Initialize Observability (tracing, metrics, sentry)
await initObservability()

// Initialize Orchestrator
initOrchestrator({
  daytonaApiKey: Config.DAYTONA_API_KEY!,
  daytonaApiUrl: Config.DAYTONA_API_URL,
  daytonaTarget: Config.DAYTONA_TARGET,
  encryptionKey: Config.ENCRYPTION_KEY,
  convexUrl: Config.CONVEX_URL!,
})

// Create HTTP server with Hono request listener
const requestListener = getRequestListener(App().fetch)
const server = createServer(requestListener)

// WebSocket proxy for PTY connections
const wssProxy = createPtyWebSocketServer()

server.on("upgrade", async (req: IncomingMessage, socket: any, head: Buffer) => {
  console.log("[Server] Upgrade request:", req.url)
  const handled = await handlePtyUpgrade(wssProxy, req, socket, head)
  if (!handled) {
    // Not a PTY request - destroy the socket
    socket.destroy()
  }
})

server.on("error", (err: any) => {
  if (err?.code === "EADDRINUSE") {
    console.error(`[Server] Port ${Config.PORT} already in use. Set PORT to a free port.`)
  } else if (err?.code === "EPERM") {
    console.error(
      `[Server] Not permitted to bind to ${Config.HOST}:${Config.PORT}. Try a different PORT or check OS/sandbox restrictions.`,
    )
  } else {
    console.error("[Server] Failed to start:", err)
  }
  process.exit(1)
})

server.listen(Config.PORT, Config.HOST, () => {
  console.log(`Server is running on http://${Config.HOST}:${Config.PORT}`)

  // In local mode, set up the OpenCode backend
  if (!Config.SANDBOX_ENABLED) {
    if (Config.USE_RIVET_SANDBOX_AGENT_SERVER) {
      // Use sandbox-agent for opencode (supports switching to claude/codex/amp)
      spawnSandboxAgent("opencode").catch((err) => {
        console.error("[Server] Failed to auto-start sandbox-agent:", err?.message || err)
      })
    } else {
      // Direct Local Mode: Try to auto-spawn opencode directly
      // If it fails (e.g. port stored), we assume user is running it manually.
      import("./routes/local-runner.ts").then(({ spawnLocalOpenCode }) => {
          spawnLocalOpenCode().catch((err) => {
              console.warn("[Server] Auto-spawn of local OpenCode failed (likely running manually):", err.message)
          })
      })

      if (Config.OPENCODE_PORT !== Config.PORT) {
        // Direct proxy to local OpenCode server — bridge its events into the gateway bus
        startBridge(`http://127.0.0.1:${Config.OPENCODE_PORT}`)
      }
    }
  }
})

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  console.log(`[Server] ${signal} received, starting graceful shutdown...`)

  // Stop event bridge
  stopBridge()

  // Kill sandbox-agent subprocess if running
  await killSandboxAgent()
  
  // Kill local opencode if running
  await import("./routes/local-runner.ts").then(({ killLocalOpenCode }) => killLocalOpenCode())

  // Close HTTP server
  server.close(() => {
    console.log("[Server] HTTP server closed")
  })

  // Shutdown observability
  await shutdownObservability()

  process.exit(0)
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"))
process.on("SIGINT", () => gracefulShutdown("SIGINT"))

// Export for external use
export { server, App }
