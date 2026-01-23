import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import type { ClientChannel } from "ssh2"
import z from "zod"
import { Identifier } from "../id/id"
import { Log } from "../util/log"
import type { WSContext } from "hono/ws"
import { Instance } from "../project/instance"
import { VpsConnection } from "./connection"

export namespace VpsPty {
  const log = Log.create({ service: "vps.pty" })

  const BUFFER_LIMIT = 1024 * 1024 * 2 // 2MB
  const BUFFER_CHUNK = 64 * 1024 // 64KB

  export const Info = z
    .object({
      id: Identifier.schema("vpspty"),
      vpsId: Identifier.schema("vps"),
      configKey: z.string(),
      title: z.string(),
      cwd: z.string(),
      status: z.enum(["running", "exited"]),
    })
    .meta({ ref: "VpsPtyInfo" })

  export type Info = z.infer<typeof Info>

  export const CreateInput = z.object({
    vpsId: z.string(),
    configKey: z.string(),
    title: z.string().optional(),
    cwd: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
    cols: z.number().optional(),
    rows: z.number().optional(),
  })

  export type CreateInput = z.infer<typeof CreateInput>

  export const Event = {
    Created: BusEvent.define("vpspty.created", z.object({ info: Info })),
    Updated: BusEvent.define("vpspty.updated", z.object({ info: Info })),
    Exited: BusEvent.define("vpspty.exited", z.object({ id: Identifier.schema("vpspty") })),
    Deleted: BusEvent.define("vpspty.deleted", z.object({ id: Identifier.schema("vpspty") })),
    Data: BusEvent.define("vpspty.data", z.object({ id: Identifier.schema("vpspty"), data: z.string() })),
  }

  interface ActiveSession {
    info: Info
    channel: ClientChannel
    buffer: string
    subscribers: Set<WSContext>
  }

  const state = Instance.state(
    () => new Map<string, ActiveSession>(),
    async (sessions) => {
      for (const session of sessions.values()) {
        try {
          session.channel.close()
        } catch {}
        for (const ws of session.subscribers) {
          ws.close()
        }
      }
      sessions.clear()
    }
  )

  /**
   * Create a new VPS PTY session (interactive shell)
   */
  export async function create(input: CreateInput): Promise<Info> {
    const id = Identifier.create("vpspty", false)
    const client = VpsConnection.getClient(input.vpsId)

    if (!client) {
      throw new Error(`VPS connection ${input.vpsId} not found`)
    }

    const vpsInfo = VpsConnection.get(input.vpsId)!

    return new Promise((resolve, reject) => {
      const ptyOptions = {
        term: "xterm-256color",
        cols: input.cols || 80,
        rows: input.rows || 24,
      }

      client.shell(ptyOptions, (err, channel) => {
        if (err) {
          log.error("Failed to create VPS shell", { vpsId: input.vpsId, error: err.message })
          reject(err)
          return
        }

        const info: Info = {
          id,
          vpsId: input.vpsId,
          configKey: input.configKey,
          title: input.title || `${vpsInfo.nickname} - Terminal`,
          cwd: input.cwd || vpsInfo.defaultDirectory || "~",
          status: "running",
        }

        const session: ActiveSession = {
          info,
          channel,
          buffer: "",
          subscribers: new Set(),
        }

        state().set(id, session)

        channel.on("data", (data: Buffer) => {
          const dataStr = data.toString("utf-8")

          // Send to all subscribers
          let hasActiveSubscriber = false
          for (const ws of session.subscribers) {
            if (ws.readyState !== 1) {
              session.subscribers.delete(ws)
              continue
            }
            hasActiveSubscriber = true
            try {
              ws.send(dataStr)
            } catch {
              session.subscribers.delete(ws)
            }
          }

          // Buffer if no active subscribers
          if (!hasActiveSubscriber) {
            session.buffer += dataStr
            if (session.buffer.length > BUFFER_LIMIT) {
              session.buffer = session.buffer.slice(-BUFFER_LIMIT)
            }
          }

          // Publish data event
          Bus.publish(Event.Data, { id, data: dataStr })
        })

        channel.stderr.on("data", (data: Buffer) => {
          const dataStr = data.toString("utf-8")
          for (const ws of session.subscribers) {
            if (ws.readyState === 1) {
              try {
                ws.send(dataStr)
              } catch {
                session.subscribers.delete(ws)
              }
            }
          }
        })

        channel.on("close", () => {
          log.info("VPS PTY session closed", { id })
          session.info.status = "exited"

          for (const ws of session.subscribers) {
            ws.close()
          }
          session.subscribers.clear()

          Bus.publish(Event.Exited, { id })
          state().delete(id)
        })

        channel.on("error", (err: Error) => {
          log.error("VPS PTY channel error", { id, error: err.message })
        })

        // Set initial directory
        if (input.cwd && input.cwd !== "~") {
          channel.write(`cd ${JSON.stringify(input.cwd)}\n`)
        }

        // Set environment variables
        if (input.env) {
          for (const [key, value] of Object.entries(input.env)) {
            channel.write(`export ${key}=${JSON.stringify(value)}\n`)
          }
        }

        // Clear screen for clean start
        channel.write("clear\n")

        log.info("VPS PTY session created", { id, vpsId: input.vpsId, configKey: input.configKey })
        Bus.publish(Event.Created, { info })
        resolve(info)
      })
    })
  }

  /**
   * List all active VPS PTY sessions
   */
  export function list(): Info[] {
    return Array.from(state().values()).map((s) => s.info)
  }

  /**
   * List VPS PTY sessions for a specific VPS
   */
  export function listByVps(vpsId: string): Info[] {
    return Array.from(state().values())
      .filter((s) => s.info.vpsId === vpsId)
      .map((s) => s.info)
  }

  /**
   * Get VPS PTY session info
   */
  export function get(id: string): Info | undefined {
    return state().get(id)?.info
  }

  /**
   * Write data to VPS PTY session
   */
  export function write(id: string, data: string): void {
    const session = state().get(id)
    if (session && session.info.status === "running") {
      session.channel.write(data)
    }
  }

  /**
   * Resize VPS PTY session
   */
  export function resize(id: string, cols: number, rows: number): void {
    const session = state().get(id)
    if (session && session.info.status === "running") {
      session.channel.setWindow(rows, cols, rows * 16, cols * 8)
    }
  }

  /**
   * Update VPS PTY session
   */
  export function update(id: string, updates: { title?: string; cwd?: string }): Info | undefined {
    const session = state().get(id)
    if (!session) return undefined

    if (updates.title) {
      session.info.title = updates.title
    }
    if (updates.cwd) {
      session.info.cwd = updates.cwd
    }

    Bus.publish(Event.Updated, { info: session.info })
    return session.info
  }

  /**
   * Remove VPS PTY session
   */
  export async function remove(id: string): Promise<void> {
    const session = state().get(id)
    if (!session) return

    log.info("Removing VPS PTY session", { id })

    try {
      session.channel.close()
    } catch {}

    for (const ws of session.subscribers) {
      ws.close()
    }

    state().delete(id)
    Bus.publish(Event.Deleted, { id })
  }

  /**
   * Connect WebSocket to VPS PTY session
   */
  export function connect(id: string, ws: WSContext) {
    const session = state().get(id)
    if (!session) {
      ws.close()
      return
    }

    log.info("Client connected to VPS PTY session", { id })
    session.subscribers.add(ws)

    // Send buffered data
    if (session.buffer) {
      const buffer = session.buffer.length <= BUFFER_LIMIT ? session.buffer : session.buffer.slice(-BUFFER_LIMIT)
      session.buffer = ""

      try {
        for (let i = 0; i < buffer.length; i += BUFFER_CHUNK) {
          ws.send(buffer.slice(i, i + BUFFER_CHUNK))
        }
      } catch {
        session.subscribers.delete(ws)
        session.buffer = buffer
        ws.close()
        return
      }
    }

    return {
      onMessage: (message: string | ArrayBuffer) => {
        if (session.info.status === "running") {
          session.channel.write(String(message))
        }
      },
      onClose: () => {
        log.info("Client disconnected from VPS PTY session", { id })
        session.subscribers.delete(ws)
      },
    }
  }

  /**
   * Send signal to VPS PTY session
   */
  export function signal(id: string, signal: string): void {
    const session = state().get(id)
    if (session && session.info.status === "running") {
      // Send control characters for common signals
      switch (signal.toUpperCase()) {
        case "SIGINT":
          session.channel.write("\x03") // Ctrl+C
          break
        case "SIGTSTP":
          session.channel.write("\x1a") // Ctrl+Z
          break
        case "SIGQUIT":
          session.channel.write("\x1c") // Ctrl+\
          break
        case "EOF":
          session.channel.write("\x04") // Ctrl+D
          break
      }
    }
  }
}
