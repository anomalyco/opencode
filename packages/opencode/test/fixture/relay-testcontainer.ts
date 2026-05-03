/**
 * Relay Testcontainer Fixture
 * 
 * Spawns the Veritly relay server in a container.
 * The relay WebSocket server connects backend (agents) to browser.
 * 
 * For testing, we simulate both sides:
 * - Agent: Uses RelaySDK to send commands
 * - Browser: Simulated WebSocket client that receives and responds
 */

import { GenericContainer, StartedTestContainer, Wait } from "testcontainers"
import { Log } from "../../src/util/log"
import { Relay } from "../../src/relay/sdk"
import type { RelayRequest, RelayResponse } from "../../src/relay/sdk"

const log = Log.create({ service: "relay-testcontainer" })

export interface RelayTestContext {
  container: StartedTestContainer
  relayUrl: string
  agentUrl: string
  agent: ReturnType<typeof Relay.create>
  healthUrl: string
  host: string
  port: number
}

// Track active containers
const activeContainers: StartedTestContainer[] = []

/**
 * Simulated Browser Client for testing
 * Connects to relay as "browser" role and handles incoming commands
 */
export class SimulatedBrowser {
  private ws: WebSocket | null = null
  private relayUrl: string
  private handlers = new Map<string, (params: unknown) => Promise<unknown>>()

  constructor(relayUrl: string) {
    // Switch from agent URL to browser URL
    this.relayUrl = relayUrl.replace("role=agent", "role=browser")
  }

  /**
   * Register a handler for a specific operation
   */
  on(op: string, handler: (params: unknown) => Promise<unknown>): void {
    this.handlers.set(op, handler)
  }

  /**
   * Connect as browser
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.relayUrl)

      this.ws.onopen = () => {
        log.info("SimulatedBrowser connected to relay")
        resolve()
      }

      this.ws.onmessage = async (event) => {
        try {
          const req = JSON.parse(event.data) as RelayRequest
          log.debug("Browser received request", { id: req.id, op: req.op })

          const handler = this.handlers.get(req.op)
          let response: RelayResponse

          if (handler) {
            try {
              const result = await handler(req.params)
              response = { id: req.id, ok: true, result }
            } catch (error: any) {
              response = { id: req.id, ok: false, error: error.message }
            }
          } else {
            response = { id: req.id, ok: false, error: `Unknown operation: ${req.op}` }
          }

          this.ws?.send(JSON.stringify(response))
          log.debug("Browser sent response", { id: req.id, ok: response.ok })
        } catch (error) {
          log.error("Browser failed to handle message", { error, data: event.data })
        }
      }

      this.ws.onerror = (error) => {
        log.error("Browser WebSocket error", { error })
        reject(error)
      }
    })
  }

  /**
   * Disconnect
   */
  disconnect(): void {
    this.ws?.close()
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }
}

/**
 * Start relay container
 */
export async function startRelayContainer(): Promise<RelayTestContext> {
  log.info("Starting relay container...")

  // Get repo root: from packages/opencode/test/fixture -> repo root is 4 levels up
  const repoRoot = path.resolve(__dirname, "../../../..")

  // Use Bun image and mount relay code
  const container = await new GenericContainer("oven/bun:1.1")
    .withExposedPorts(8080)
    .withBindMounts([{
      source: path.join(repoRoot, "packages/relay"),
      target: "/relay",
      bindMode: "ro",
    }])
    .withWorkingDir("/relay")
    .withCommand(["bun", "run", "server.ts"])
    .withWaitStrategy(Wait.forHttp("/readyz", 8080))
    .withStartupTimeout(30000)
    .start()

  activeContainers.push(container)

  const host = container.getHost()
  const port = container.getMappedPort(8080)
  const relayUrl = `ws://${host}:${port}/relay/ws`
  const agentUrl = `${relayUrl}?role=agent`
  const healthUrl = `http://${host}:${port}/relay/readyz`

  log.info("Relay ready", { host, port, relayUrl })

  const agent = Relay.create({ relayUrl: agentUrl })

  return {
    container,
    relayUrl,
    agentUrl,
    agent,
    healthUrl,
    host,
    port,
  }
}

/**
 * Stop relay container
 */
export async function stopRelayContainer(ctx: RelayTestContext): Promise<void> {
  if (ctx?.container) {
    log.info("Stopping relay container...")
    await ctx.container.stop()
    const idx = activeContainers.indexOf(ctx.container)
    if (idx > -1) activeContainers.splice(idx, 1)
    log.info("Relay container stopped")
  }
}

/**
 * Cleanup all containers
 */
export async function cleanupAllRelayContainers(): Promise<void> {
  log.info(`Cleaning up ${activeContainers.length} relay containers...`)
  for (const container of [...activeContainers]) {
    try {
      await container.stop()
    } catch (error) {
      log.error("Failed to stop container", { error })
    }
  }
  activeContainers.length = 0
}

/**
 * Test helper
 */
export async function withRelay<T>(
  fn: (ctx: RelayTestContext, browser: SimulatedBrowser) => Promise<T>,
): Promise<T> {
  const ctx = await startRelayContainer()
  const browser = new SimulatedBrowser(ctx.relayUrl)
  browser = new SimulatedBrowser(ctx.relayUrl)
  await browser.connect()
  
  // Also connect agent
  await ctx.agent.connect()
  
  try {
    return await fn(ctx, browser)
  } finally {
    browser?.disconnect()
    ctx?.agent.disconnect()
    await stopRelayContainer(ctx)
  }
}
