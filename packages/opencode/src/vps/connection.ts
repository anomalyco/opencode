import { Client, type ClientChannel, type SFTPWrapper } from "ssh2"
import z from "zod"
import { Identifier } from "../id/id"
import { Log } from "../util/log"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import type { Config } from "../config/config"
import { VpsAuth } from "./auth"
import { Instance } from "../project/instance"

export namespace VpsConnection {
  const log = Log.create({ service: "vps.connection" })

  export const Info = z
    .object({
      id: Identifier.schema("vps"),
      configKey: z.string(),
      nickname: z.string(),
      host: z.string(),
      port: z.number(),
      user: z.string(),
      status: z.enum(["connecting", "connected", "disconnected", "error"]),
      connectedAt: z.number().optional(),
      lastError: z.string().optional(),
      defaultDirectory: z.string().optional(),
    })
    .meta({ ref: "VpsConnectionInfo" })

  export type Info = z.infer<typeof Info>

  export const Event = {
    Connecting: BusEvent.define("vps.connecting", z.object({ info: Info })),
    Connected: BusEvent.define("vps.connected", z.object({ info: Info })),
    Disconnected: BusEvent.define("vps.disconnected", z.object({ info: Info })),
    Error: BusEvent.define("vps.error", z.object({ info: Info, error: z.string() })),
  }

  interface ActiveConnection {
    info: Info
    client: Client
    config: Config.VpsConnection
    sftp?: SFTPWrapper
    reconnectTimer?: ReturnType<typeof setTimeout>
  }

  const state = Instance.state(
    () => new Map<string, ActiveConnection>(),
    async (connections) => {
      for (const conn of connections.values()) {
        try {
          conn.client.end()
        } catch {}
        if (conn.reconnectTimer) {
          clearTimeout(conn.reconnectTimer)
        }
      }
      connections.clear()
    }
  )

  /**
   * Connect to a VPS server
   */
  export async function connect(
    configKey: string,
    config: Config.VpsConnection,
    options?: { password?: string }
  ): Promise<Info> {
    const id = Identifier.create("vps", false)
    const info: Info = {
      id,
      configKey,
      nickname: config.nickname || configKey,
      host: config.host,
      port: config.port || 22,
      user: config.user,
      status: "connecting",
      defaultDirectory: config.defaultDirectory,
    }

    const client = new Client()
    const connection: ActiveConnection = {
      info,
      client,
      config,
    }

    state().set(id, connection)
    Bus.publish(Event.Connecting, { info })

    return new Promise((resolve, reject) => {
      client.on("ready", () => {
        log.info("SSH connection established", { id, host: config.host, user: config.user })
        connection.info.status = "connected"
        connection.info.connectedAt = Date.now()
        Bus.publish(Event.Connected, { info: connection.info })
        resolve(connection.info)
      })

      client.on("error", (err) => {
        log.error("SSH connection error", { id, error: err.message })
        connection.info.status = "error"
        connection.info.lastError = err.message
        Bus.publish(Event.Error, { info: connection.info, error: err.message })
        state().delete(id)
        reject(err)
      })

      client.on("close", () => {
        log.info("SSH connection closed", { id })
        const wasConnected = connection.info.status === "connected"
        connection.info.status = "disconnected"
        Bus.publish(Event.Disconnected, { info: connection.info })

        // Auto-reconnect if was previously connected
        if (wasConnected && config.keepAliveInterval > 0) {
          log.info("Scheduling reconnect", { id, delay: 5000 })
          connection.reconnectTimer = setTimeout(async () => {
            try {
              await reconnect(id)
            } catch (err: any) {
              log.error("Reconnect failed", { id, error: err.message })
            }
          }, 5000)
        }
      })

      client.on("end", () => {
        log.info("SSH connection ended", { id })
      })

      // Prepare connection options
      VpsAuth.getCredentials(config)
        .then((credentials) => {
          const connectConfig: any = {
            host: config.host,
            port: config.port || 22,
            username: config.user,
            keepaliveInterval: config.keepAliveInterval || 30000,
            keepaliveCountMax: 3,
            agentForward: config.forwardAgent || false,
            readyTimeout: 30000,
          }

          // Handle password from options (interactive prompt) or credentials
          if (options?.password) {
            connectConfig.password = options.password
          } else if (credentials.password) {
            connectConfig.password = credentials.password
          } else if (credentials.privateKey) {
            connectConfig.privateKey = credentials.privateKey
            if (credentials.passphrase) {
              connectConfig.passphrase = credentials.passphrase
            }
          } else if (credentials.agent) {
            connectConfig.agent = credentials.agent
          }

          log.info("Connecting to SSH", {
            host: config.host,
            port: config.port,
            user: config.user,
            authType: config.auth.type,
          })

          client.connect(connectConfig)
        })
        .catch(reject)
    })
  }

  /**
   * Reconnect an existing connection
   */
  export async function reconnect(id: string): Promise<Info> {
    const connection = state().get(id)
    if (!connection) {
      throw new Error(`Connection ${id} not found`)
    }

    connection.client.end()
    state().delete(id)

    return connect(connection.info.configKey, connection.config)
  }

  /**
   * Disconnect from a VPS
   */
  export function disconnect(id: string): void {
    const connection = state().get(id)
    if (!connection) return

    log.info("Disconnecting from VPS", { id, host: connection.info.host })

    if (connection.reconnectTimer) {
      clearTimeout(connection.reconnectTimer)
    }

    try {
      connection.client.end()
    } catch {}

    state().delete(id)
  }

  /**
   * Disconnect from a VPS by config key
   */
  export function disconnectByKey(configKey: string): void {
    const connection = Array.from(state().values()).find((c) => c.info.configKey === configKey)
    if (connection) {
      disconnect(connection.info.id)
    }
  }

  /**
   * Get connection info
   */
  export function get(id: string): Info | undefined {
    return state().get(id)?.info
  }

  /**
   * Get connection by config key
   */
  export function getByKey(configKey: string): Info | undefined {
    return Array.from(state().values()).find((c) => c.info.configKey === configKey)?.info
  }

  /**
   * Get SSH client for a connection
   */
  export function getClient(id: string): Client | undefined {
    return state().get(id)?.client
  }

  /**
   * Get SFTP wrapper for a connection (lazy initialization)
   */
  export async function getSftp(id: string): Promise<SFTPWrapper> {
    const connection = state().get(id)
    if (!connection) {
      throw new Error(`Connection ${id} not found`)
    }

    if (connection.sftp) {
      return connection.sftp
    }

    return new Promise((resolve, reject) => {
      connection.client.sftp((err, sftp) => {
        if (err) {
          reject(err)
          return
        }
        connection.sftp = sftp
        resolve(sftp)
      })
    })
  }

  /**
   * List all active connections
   */
  export function list(): Info[] {
    return Array.from(state().values()).map((c) => c.info)
  }

  /**
   * Disconnect all connections
   */
  export function disconnectAll(): void {
    for (const id of state().keys()) {
      disconnect(id)
    }
  }

  /**
   * Execute a command on the remote server
   */
  export async function exec(
    id: string,
    command: string,
    options?: { cwd?: string; env?: Record<string, string>; timeout?: number }
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const client = getClient(id)
    if (!client) {
      throw new Error(`Connection ${id} not found`)
    }

    return new Promise((resolve, reject) => {
      let fullCommand = command
      if (options?.cwd) {
        fullCommand = `cd ${JSON.stringify(options.cwd)} && ${command}`
      }

      if (options?.env) {
        const envStr = Object.entries(options.env)
          .map(([k, v]) => `export ${k}=${JSON.stringify(v)}`)
          .join("; ")
        fullCommand = `${envStr}; ${fullCommand}`
      }

      client.exec(fullCommand, (err, stream) => {
        if (err) {
          reject(err)
          return
        }

        let stdout = ""
        let stderr = ""

        stream.on("data", (data: Buffer) => {
          stdout += data.toString()
        })

        stream.stderr.on("data", (data: Buffer) => {
          stderr += data.toString()
        })

        stream.on("close", (code: number) => {
          resolve({ stdout, stderr, exitCode: code ?? 0 })
        })

        stream.on("error", reject)

        // Handle timeout
        if (options?.timeout) {
          setTimeout(() => {
            stream.close()
            reject(new Error(`Command timeout after ${options.timeout}ms`))
          }, options.timeout)
        }
      })
    })
  }

  /**
   * Check if a connection is active and connected
   */
  export function isConnected(id: string): boolean {
    const connection = state().get(id)
    return connection?.info.status === "connected"
  }

  /**
   * Check if any connection exists for a config key
   */
  export function hasConnection(configKey: string): boolean {
    return Array.from(state().values()).some(
      (c) => c.info.configKey === configKey && c.info.status === "connected"
    )
  }
}
