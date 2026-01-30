import Docker from "dockerode"
import { randomBytes } from "crypto"
import { config } from "../config"

const docker = new Docker({ socketPath: config.DOCKER_SOCKET })

export interface ContainerInfo {
  id: string
  ip: string
  port: number
  authToken: string
  workspaceDir: string
  status: "creating" | "running" | "stopping" | "stopped" | "error"
  createdAt: Date
  lastActivityAt: Date
  networkId?: string
}

// In-memory container state (should be synced with database in production)
const containers = new Map<string, ContainerInfo>()

export namespace ContainerManager {
  /**
   * Create and start a new sandbox container for a session
   */
  export async function create(input: {
    sessionId: string
    workspaceVolume: string
  }): Promise<ContainerInfo> {
    const { sessionId, workspaceVolume } = input
    const authToken = randomBytes(32).toString("hex")
    const containerName = `opencode-sandbox-${sessionId.slice(0, 12)}`

    try {
      // Create isolated network for this container
      const networkName = `opencode-net-${sessionId.slice(0, 12)}`
      let network: Docker.Network

      try {
        network = await docker.createNetwork({
          Name: networkName,
          Driver: "bridge",
          Internal: false, // Allow outbound connections
          Options: {
            "com.docker.network.bridge.enable_icc": "false", // Disable inter-container communication
          },
          Labels: {
            "opencode.session": sessionId,
            "opencode.managed": "true",
          },
        })
      } catch (error: any) {
        // Network might already exist
        if (error.statusCode === 409) {
          network = docker.getNetwork(networkName)
        } else {
          throw error
        }
      }

      // Create container
      const container = await docker.createContainer({
        Image: config.SANDBOX_IMAGE,
        name: containerName,
        Env: [
          `OPENCODE_SERVER_PASSWORD=${authToken}`,
          `OPENCODE_SERVER_USERNAME=api`,
        ],
        Labels: {
          "opencode.session": sessionId,
          "opencode.managed": "true",
        },
        HostConfig: {
          // Resource limits
          Memory: config.SANDBOX_MEMORY_LIMIT,
          NanoCpus: config.SANDBOX_CPU_LIMIT * 1e9,
          PidsLimit: 256,

          // Storage
          Binds: [`${workspaceVolume}:/workspace:rw`],

          // Network
          NetworkMode: networkName,

          // Security hardening
          CapDrop: ["ALL"],
          CapAdd: ["CHOWN", "SETUID", "SETGID", "DAC_OVERRIDE"],
          SecurityOpt: ["no-new-privileges:true"],
          ReadonlyRootfs: false,

          // Disable host access
          Privileged: false,
          IpcMode: "none",

          // Auto-remove on stop (optional, comment out for debugging)
          // AutoRemove: true,
        },
        ExposedPorts: {
          "4096/tcp": {},
        },
      })

      // Start container
      await container.start()

      // Wait for container to be healthy (with timeout)
      await waitForHealthy(container, 30000)

      // Get container IP address
      const info = await container.inspect()
      const networkInfo = info.NetworkSettings.Networks[networkName]
      const ip = networkInfo?.IPAddress

      if (!ip) {
        throw new Error("Failed to get container IP address")
      }

      const containerInfo: ContainerInfo = {
        id: container.id,
        ip,
        port: 4096,
        authToken,
        workspaceDir: "/workspace",
        status: "running",
        createdAt: new Date(),
        lastActivityAt: new Date(),
        networkId: network.id,
      }

      containers.set(sessionId, containerInfo)
      return containerInfo
    } catch (error) {
      // Cleanup on failure
      try {
        const existingContainer = docker.getContainer(containerName)
        await existingContainer.stop({ t: 0 }).catch(() => {})
        await existingContainer.remove({ force: true }).catch(() => {})
      } catch {
        // Ignore cleanup errors
      }
      throw error
    }
  }

  /**
   * Stop and remove a container
   */
  export async function stop(sessionId: string): Promise<void> {
    const info = containers.get(sessionId)
    if (!info) return

    try {
      info.status = "stopping"
      const container = docker.getContainer(info.id)

      // Stop container with 10s timeout
      await container.stop({ t: 10 }).catch(() => {})

      // Remove container
      await container.remove({ force: true }).catch(() => {})

      // Remove network if exists
      if (info.networkId) {
        try {
          const network = docker.getNetwork(info.networkId)
          await network.remove()
        } catch {
          // Ignore network removal errors
        }
      }

      containers.delete(sessionId)
    } catch (error) {
      console.error(`Failed to stop container for session ${sessionId}:`, error)
      info.status = "error"
    }
  }

  /**
   * Get container info for a session
   */
  export function get(sessionId: string): ContainerInfo | undefined {
    return containers.get(sessionId)
  }

  /**
   * Ensure container is running, create if necessary
   */
  export async function ensureRunning(
    sessionId: string,
    workspaceVolume: string
  ): Promise<ContainerInfo> {
    const existing = containers.get(sessionId)

    if (existing?.status === "running") {
      existing.lastActivityAt = new Date()
      return existing
    }

    // If container exists but not running, remove it first
    if (existing) {
      await stop(sessionId)
    }

    // Create new container
    return create({ sessionId, workspaceVolume })
  }

  /**
   * Update last activity timestamp
   */
  export function touch(sessionId: string): void {
    const info = containers.get(sessionId)
    if (info) {
      info.lastActivityAt = new Date()
    }
  }

  /**
   * List all containers
   */
  export function list(): Map<string, ContainerInfo> {
    return containers
  }

  /**
   * Get containers that have been idle for too long
   */
  export function getIdleContainers(): Array<{ sessionId: string; info: ContainerInfo }> {
    const now = Date.now()
    const idle: Array<{ sessionId: string; info: ContainerInfo }> = []

    for (const [sessionId, info] of containers) {
      if (info.status === "running") {
        const idleTime = now - info.lastActivityAt.getTime()
        if (idleTime > config.SANDBOX_IDLE_TIMEOUT) {
          idle.push({ sessionId, info })
        }
      }
    }

    return idle
  }

  /**
   * Make a request to a container's opencode server
   */
  export async function fetch(
    sessionId: string,
    path: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const info = containers.get(sessionId)
    if (!info || info.status !== "running") {
      throw new Error(`Container for session ${sessionId} is not running`)
    }

    touch(sessionId)

    const url = `http://${info.ip}:${info.port}${path}`
    const headers = new Headers(options.headers)
    headers.set("Authorization", `Basic ${btoa(`api:${info.authToken}`)}`)
    headers.set("x-opencode-directory", info.workspaceDir)

    return globalThis.fetch(url, {
      ...options,
      headers,
    })
  }
}

/**
 * Wait for container to be healthy
 */
async function waitForHealthy(container: Docker.Container, timeoutMs: number): Promise<void> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeoutMs) {
    try {
      const info = await container.inspect()
      const health = info.State.Health

      // If no health check defined, just check if running
      if (!health) {
        if (info.State.Running) {
          // Give it a moment to start the server
          await Bun.sleep(1000)
          return
        }
      } else if (health.Status === "healthy") {
        return
      } else if (health.Status === "unhealthy") {
        throw new Error("Container health check failed")
      }
    } catch (error: any) {
      if (error.message?.includes("unhealthy")) {
        throw error
      }
    }

    await Bun.sleep(500)
  }

  throw new Error(`Container health check timed out after ${timeoutMs}ms`)
}
