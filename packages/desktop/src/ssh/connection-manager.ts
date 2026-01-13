import { ConnectionProfile, ProfileManager } from "./profile-manager"
import { createTunnelConnection, TunnelConnectionConfig, TunnelConnectionResult, TunnelConnectionError } from "./tunnel-connection"
import { ServerHealthInfo } from "./server-discovery"
import { SshTunnelHandle } from "./types"
import { ReconnectionManager } from "./reconnection-manager"
import { HealthMonitor } from "./health-monitor"
import { getRecoverySuggestions } from "./error-recovery"

export enum ConnectionState {
  Idle = "idle",
  Starting = "starting",
  Discovering = "discovering",
  Bootstrapping = "bootstrapping",
  Connected = "connected",
  Reconnecting = "reconnecting",
  Failed = "failed",
}

export interface ConnectionError {
  type: "process_error" | "auth_error" | "network_error" | "discovery_error" | "bootstrap_error" | "config_error"
  message: string
  details?: string
  sshStderr?: string
  timestamp: string
  recovery?: {
    suggestions: Array<{ action: string; description: string; priority: "high" | "medium" | "low" }>
    canRetry: boolean
    retryDelayMs?: number
  }
}

export interface Connection {
  id: string
  profileId: string
  state: ConnectionState
  localEndpoint?: { host: string; port: number }
  serverInfo?: ServerHealthInfo
  error?: ConnectionError
  createdAt: string
  connectedAt?: string
}

type StateChangeListener = (connectionId: string, state: ConnectionState, connection: Connection) => void

export class ConnectionManager {
  private connections = new Map<string, Connection>()
  private listeners = new Set<StateChangeListener>()
  private processes = new Map<string, { process: any; handle: SshTunnelHandle }>()
  private profileManager: ProfileManager
  private connectionPool = new Map<string, Connection>()
  private reconnectionManager = new ReconnectionManager()
  private healthMonitor = new HealthMonitor()

  constructor(profileManager?: ProfileManager) {
    this.profileManager = profileManager ?? new ProfileManager()
    
    this.healthMonitor.onHealthChange((connectionId, healthy, result) => {
      const connection = this.connections.get(connectionId)
      if (!connection) return

      if (!healthy && connection.profileId) {
        const profile = this.profileManager.get(connection.profileId)
        profile.then((p) => {
          if (p?.autoReconnect) {
            this.connect(p.id, false).catch(() => {})
          } else {
            this.setState(connectionId, {
              state: ConnectionState.Failed,
              error: {
                type: "network_error",
                message: "Connection health check failed",
                details: result.error,
                timestamp: new Date().toISOString(),
              },
            })
          }
        })
      }
    })
  }

  onStateChange(callback: StateChangeListener): () => void {
    this.listeners.add(callback)
    return () => {
      this.listeners.delete(callback)
    }
  }

  private notifyListeners(connectionId: string, state: ConnectionState, connection: Connection): void {
    for (const listener of this.listeners) {
      try {
        listener(connectionId, state, connection)
      } catch (error) {
        console.error("Error in connection state listener:", error)
      }
    }
  }

  private setState(connectionId: string, updates: Partial<Connection>): Connection {
    const current = this.connections.get(connectionId)
    if (!current) {
      throw new Error(`Connection ${connectionId} not found`)
    }

    const updated: Connection = { ...current, ...updates }
    this.connections.set(connectionId, updated)
    this.notifyListeners(connectionId, updated.state, updated)
    return updated
  }

  async connect(profileId: string, reuseExisting: boolean = true): Promise<Connection> {
    const profile = await this.profileManager.get(profileId)
    if (!profile) {
      throw new Error(`Profile ${profileId} not found`)
    }

    if (reuseExisting) {
      const existing = this.connectionPool.get(profileId)
      if (existing && existing.state === ConnectionState.Connected) {
        const processInfo = this.processes.get(existing.id)
        if (processInfo && processInfo.process) {
          return existing
        }
      }

      const existingInConnections = Array.from(this.connections.values()).find(
        (c) => c.profileId === profileId && c.state === ConnectionState.Connected
      )
      if (existingInConnections) {
        this.connectionPool.set(profileId, existingInConnections)
        return existingInConnections
      }
    }

    const connectionId = `conn-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const connection: Connection = {
      id: connectionId,
      profileId,
      state: ConnectionState.Starting,
      createdAt: new Date().toISOString(),
    }

    this.connections.set(connectionId, connection)
    this.notifyListeners(connectionId, connection.state, connection)

    this.establishConnection(connection, profile).catch((error) => {
      console.error("Connection error:", error)
      const current = this.connections.get(connectionId)
      if (current) {
        this.setState(connectionId, {
          state: ConnectionState.Failed,
          error: {
            type: "config_error",
            message: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString(),
          },
        })
      }
    })

    return connection
  }

  private async establishConnection(connection: Connection, profile: ConnectionProfile): Promise<void> {
    const connectionId = connection.id

    try {
      this.setState(connectionId, { state: ConnectionState.Starting })

      const config: TunnelConnectionConfig = {
        sshParams: {
          host: profile.host,
          user: profile.user,
          port: profile.port,
          identityFile: profile.identityFile,
          identityFiles: profile.identityFiles,
          forwardAgent: profile.forwardAgent,
          proxyJump: profile.proxyJump,
          sshConfigMode: profile.sshConfigMode,
          remotePort: profile.remoteServerPorts[0] ?? 8080,
        },
        discovery: {
          timeoutMs: 10000,
        },
      }

      const result = await createTunnelConnection(config)

      if (!result.success) {
        const errorType = this.classifyError(result)
        const recovery = getRecoverySuggestions(result.bucket ?? "unknown", result.message, result.details)
        
        const error: ConnectionError = {
          type: errorType,
          message: result.message,
          details: result.details,
          sshStderr: result.stderr,
          timestamp: new Date().toISOString(),
          recovery: {
            suggestions: recovery.suggestions,
            canRetry: recovery.canRetry,
            retryDelayMs: recovery.retryDelayMs,
          },
        }

        this.setState(connectionId, {
          state: ConnectionState.Failed,
          error,
        })

        if (profile.autoReconnect && recovery.canRetry) {
          this.handleReconnection(connectionId, profile)
        }
        return
      }

      const handle = result.handle
      const baseUrl = result.baseUrl
      const [host, portStr] = baseUrl.replace(/^https?:\/\//, "").split(":")
      const port = parseInt(portStr, 10)

      this.processes.set(connectionId, {
        process: result.process,
        handle,
      })

      if (result.discovery) {
        this.setState(connectionId, {
          state: ConnectionState.Discovering,
        })

        if (!result.discovery.compatible) {
          this.setState(connectionId, {
            state: ConnectionState.Failed,
            error: {
              type: "discovery_error",
              message: "Incompatible server version",
              details: result.discovery.reason,
              timestamp: new Date().toISOString(),
            },
          })
          return
        }

        this.setState(connectionId, {
          state: ConnectionState.Connected,
          localEndpoint: { host, port },
          serverInfo: result.discovery.info,
          connectedAt: new Date().toISOString(),
        })

        this.connectionPool.set(profile.id, this.connections.get(connectionId)!)
        this.reconnectionManager.reset(connectionId)
        this.healthMonitor.startMonitoring(connectionId, baseUrl, config.discovery)

        await this.profileManager.save({
          ...profile,
          lastUsed: new Date().toISOString(),
        })
      } else {
        this.setState(connectionId, {
          state: ConnectionState.Connected,
          localEndpoint: { host, port },
          connectedAt: new Date().toISOString(),
        })

        this.connectionPool.set(profile.id, this.connections.get(connectionId)!)
        this.reconnectionManager.reset(connectionId)
        this.healthMonitor.startMonitoring(connectionId, baseUrl, config.discovery)
      }
    } catch (error) {
      this.setState(connectionId, {
        state: ConnectionState.Failed,
        error: {
          type: "config_error",
          message: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString(),
        },
      })
    }
  }

  private classifyError(error: TunnelConnectionError): ConnectionError["type"] {
    if (error.bucket === "auth-failure") return "auth_error"
    if (error.bucket === "network-failure") return "network_error"
    if (error.bucket === "config-error") return "config_error"
    if (error.phase === "discovery") return "discovery_error"
    if (error.phase === "spawn") return "process_error"
    return "config_error"
  }

  private async handleReconnection(connectionId: string, profile: ConnectionProfile): Promise<void> {
    if (!this.reconnectionManager.shouldRetry(connectionId)) {
      this.setState(connectionId, {
        state: ConnectionState.Failed,
        error: {
          type: "network_error",
          message: "Maximum reconnection attempts reached",
          timestamp: new Date().toISOString(),
        },
      })
      return
    }

    const attempt = this.reconnectionManager.getNextAttemptNumber(connectionId)
    this.setState(connectionId, {
      state: ConnectionState.Reconnecting,
      error: undefined,
    })

    const shouldContinue = await this.reconnectionManager.waitForAttempt(connectionId, attempt)
    if (!shouldContinue) {
      this.setState(connectionId, {
        state: ConnectionState.Failed,
        error: {
          type: "network_error",
          message: "Maximum reconnection attempts reached",
          timestamp: new Date().toISOString(),
        },
      })
      return
    }

    await this.establishConnection(this.connections.get(connectionId)!, profile)
  }

  async disconnect(connectionId: string): Promise<void> {
    const connection = this.connections.get(connectionId)
    if (!connection) {
      return
    }

    this.healthMonitor.stopMonitoring(connectionId)
    this.reconnectionManager.reset(connectionId)

    const processInfo = this.processes.get(connectionId)
    if (processInfo) {
      try {
        if (processInfo.process.kill) {
          processInfo.process.kill()
        }
      } catch (error) {
        console.error("Error killing process:", error)
      }
      this.processes.delete(connectionId)
    }

    this.connectionPool.delete(connection.profileId)

    this.setState(connectionId, {
      state: ConnectionState.Idle,
      localEndpoint: undefined,
      serverInfo: undefined,
      error: undefined,
    })
  }

  getConnectionState(connectionId: string): ConnectionState | null {
    const connection = this.connections.get(connectionId)
    return connection?.state ?? null
  }

  getConnection(connectionId: string): Connection | null {
    return this.connections.get(connectionId) ?? null
  }

  listConnections(): Connection[] {
    return Array.from(this.connections.values())
  }

  getConnectionByProfile(profileId: string): Connection | null {
    return Array.from(this.connections.values()).find((c) => c.profileId === profileId && c.state === ConnectionState.Connected) ?? null
  }
}
