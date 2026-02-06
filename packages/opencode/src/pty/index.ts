import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { type IPty } from "bun-pty"
import z from "zod"
import { Identifier } from "../id/id"
import { Log } from "../util/log"
import type { WSContext } from "hono/ws"
import { Instance } from "../project/instance"
import { lazy } from "@opencode-ai/util/lazy"
import { Shell } from "@/shell/shell"
import { BrokerClient } from "@/auth/broker-client"
import { ServerAuth } from "@/config/server-auth"
import * as BrokerPty from "./broker-pty"
import { Plugin } from "@/plugin"

// Re-export broker PTY module for authenticated sessions
export { BrokerPty }

export namespace Pty {
  const log = Log.create({ service: "pty" })

  const BUFFER_LIMIT = 1024 * 1024 * 2
  const BUFFER_CHUNK = 64 * 1024
  const TERMINAL_EXIT_MESSAGE = "\r\n[opencode] Terminal session ended.\r\n"

  const pty = lazy(async () => {
    const { spawn } = await import("bun-pty")
    return spawn
  })

  export const Info = z
    .object({
      id: Identifier.schema("pty"),
      title: z.string(),
      command: z.string(),
      args: z.array(z.string()),
      cwd: z.string(),
      status: z.enum(["running", "exited"]),
      pid: z.number(),
    })
    .meta({ ref: "Pty" })

  export type Info = z.infer<typeof Info>

  export const CreateInput = z.object({
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    cwd: z.string().optional(),
    title: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
  })

  export type CreateInput = z.infer<typeof CreateInput>

  export const UpdateInput = z.object({
    title: z.string().optional(),
    size: z
      .object({
        rows: z.number(),
        cols: z.number(),
      })
      .optional(),
  })

  export type UpdateInput = z.infer<typeof UpdateInput>

  export const Event = {
    Created: BusEvent.define("pty.created", z.object({ info: Info })),
    Updated: BusEvent.define("pty.updated", z.object({ info: Info })),
    Exited: BusEvent.define("pty.exited", z.object({ id: Identifier.schema("pty"), exitCode: z.number() })),
    Deleted: BusEvent.define("pty.deleted", z.object({ id: Identifier.schema("pty") })),
  }

  interface ActiveSession {
    info: Info
    process: IPty
    buffer: string
    subscribers: Set<WSContext>
  }

  const state = Instance.state(
    () => new Map<string, ActiveSession>(),
    async (sessions) => {
      for (const session of sessions.values()) {
        try {
          session.process.kill()
        } catch {}
        for (const ws of session.subscribers) {
          ws.close()
        }
      }
      sessions.clear()
    },
  )

  const brokerState = Instance.state(
    () => new Map<string, Info>(),
    async (sessions) => {
      for (const id of sessions.keys()) {
        try {
          await BrokerPty.kill(id)
        } catch {}
      }
      sessions.clear()
    },
  )

  BrokerPty.onExit((info) => {
    const brokerInfo = brokerState().get(info.id)
    if (!brokerInfo) return
    brokerInfo.status = "exited"
    void Bus.publish(Event.Exited, { id: info.id, exitCode: 0 })
    brokerState().delete(info.id)
  })

  export function list() {
    return [...Array.from(state().values()).map((s) => s.info), ...Array.from(brokerState().values())]
  }

  export function get(id: string) {
    return state().get(id)?.info ?? brokerState().get(id)
  }

  /**
   * Create a PTY session.
   *
   * When auth is enabled and a session ID is provided, routes creation
   * through the broker for user impersonation. Otherwise uses local bun-pty.
   *
   * @param input - PTY configuration options
   * @param maybeSessionId - Optional session ID for broker-based creation
   */
  export async function create(input: CreateInput, maybeSessionId?: string, requestId?: string): Promise<Info> {
    const authConfig = ServerAuth.get()

    // If auth is enabled and session ID provided, use broker
    if (authConfig.enabled && maybeSessionId) {
      return createViaBroker(input, maybeSessionId, requestId)
    }

    // Otherwise use existing bun-pty (runs as server user)
    return createLocal(input, requestId)
  }

  /**
   * Create a PTY session via the auth broker.
   *
   * The broker spawns the process with the user's UID/GID based on
   * the session registration.
   *
   * Note: Currently throws "not yet implemented" - PTY I/O streaming
   * will be implemented in Plan 05-08.
   */
  async function createViaBroker(input: CreateInput, sessionId: string, requestId?: string): Promise<Info> {
    const command = input.command || Shell.preferred()
    const args = input.args ? [...input.args] : []
    if (command.endsWith("sh")) {
      args.push("-l")
    }
    const cwd = input.cwd || Instance.directory

    const brokerInfo = await BrokerPty.create(
      sessionId,
      {
        term: input.env?.TERM ?? "xterm-256color",
        cols: 80, // Could get from input if added
        rows: 24,
        env: input.env,
      },
      requestId,
    )

    const info: Info = {
      id: brokerInfo.ptyId,
      title: input.title || `Terminal ${brokerInfo.ptyId.slice(-4)}`,
      command,
      args,
      cwd,
      status: "running",
      pid: brokerInfo.pid,
    }

    brokerState().set(info.id, info)
    log.info("broker PTY spawned", { sessionId, requestId, method: "spawnpty", ptyId: brokerInfo.ptyId, pid: brokerInfo.pid })
    Bus.publish(Event.Created, { info })
    return info
  }

  /**
   * Create a PTY session locally using bun-pty.
   *
   * Runs as the server user (no user impersonation).
   */
  async function createLocal(input: CreateInput, requestId?: string): Promise<Info> {
    const id = Identifier.create("pty", false)
    const command = input.command || Shell.preferred()
    const args = input.args || []
    if (command.endsWith("sh")) {
      args.push("-l")
    }

    const cwd = input.cwd || Instance.directory
    const shellEnv = await Plugin.trigger("shell.env", { cwd }, { env: {} })
    const env = {
      ...process.env,
      ...input.env,
      ...shellEnv.env,
      TERM: "xterm-256color",
      OPENCODE_TERMINAL: "1",
    } as Record<string, string>

    if (process.platform === "win32") {
      env.LC_ALL = "C.UTF-8"
      env.LC_CTYPE = "C.UTF-8"
      env.LANG = "C.UTF-8"
    }
    log.info("creating session", { id, cmd: command, args, cwd, requestId })

    const spawn = await pty()
    const ptyProcess = spawn(command, args, {
      name: "xterm-256color",
      cwd,
      env,
    })

    const info = {
      id,
      title: input.title || `Terminal ${id.slice(-4)}`,
      command,
      args,
      cwd,
      status: "running",
      pid: ptyProcess.pid,
    } as const
    const session: ActiveSession = {
      info,
      process: ptyProcess,
      buffer: "",
      subscribers: new Set(),
    }
    state().set(id, session)
    ptyProcess.onData((data) => {
      let open = false
      for (const ws of session.subscribers) {
        if (ws.readyState !== 1) {
          session.subscribers.delete(ws)
          continue
        }
        open = true
        ws.send(data)
      }
      if (open) return
      session.buffer += data
      if (session.buffer.length <= BUFFER_LIMIT) return
      session.buffer = session.buffer.slice(-BUFFER_LIMIT)
    })
    ptyProcess.onExit(({ exitCode }) => {
      log.info("session exited", { id, exitCode })
      session.info.status = "exited"
      for (const ws of session.subscribers) {
        if (ws.readyState === 1) {
          try {
            ws.send(TERMINAL_EXIT_MESSAGE)
          } catch {}
        }
        ws.close()
      }
      session.subscribers.clear()
      Bus.publish(Event.Exited, { id, exitCode })
      state().delete(id)
    })
    Bus.publish(Event.Created, { info })
    return info
  }

  export async function update(id: string, input: UpdateInput) {
    const session = state().get(id)
    if (session) {
      if (input.title) {
        session.info.title = input.title
      }
      if (input.size) {
        session.process.resize(input.size.cols, input.size.rows)
      }
      Bus.publish(Event.Updated, { info: session.info })
      return session.info
    }

    const brokerInfo = brokerState().get(id)
    if (!brokerInfo) return
    if (input.title) {
      brokerInfo.title = input.title
    }
    if (input.size) {
      await BrokerPty.resize(id, input.size.cols, input.size.rows)
    }
    Bus.publish(Event.Updated, { info: brokerInfo })
    return brokerInfo
  }

  export async function remove(id: string) {
    const session = state().get(id)
    if (session) {
      log.info("removing session", { id })
      try {
        session.process.kill()
      } catch {}
      for (const ws of session.subscribers) {
        ws.close()
      }
      state().delete(id)
      Bus.publish(Event.Deleted, { id })
      return
    }

    const brokerInfo = brokerState().get(id)
    if (!brokerInfo) return
    await BrokerPty.kill(id)
    brokerState().delete(id)
    Bus.publish(Event.Deleted, { id })
  }

  export function resize(id: string, cols: number, rows: number) {
    const session = state().get(id)
    if (session && session.info.status === "running") {
      session.process.resize(cols, rows)
      return
    }

    if (brokerState().has(id)) {
      void BrokerPty.resize(id, cols, rows)
    }
  }

  export function write(id: string, data: string) {
    const session = state().get(id)
    if (session && session.info.status === "running") {
      session.process.write(data)
      return
    }

    if (brokerState().has(id)) {
      const brokerClient = new BrokerClient()
      void brokerClient.ptyWrite(id, data)
    }
  }

  export function connect(id: string, ws: WSContext, options: { requestId?: string } = {}) {
    const session = state().get(id)
    if (!session) {
      if (brokerState().has(id)) {
        return BrokerPty.connect(id, ws, options)
      }
      ws.close()
      return
    }
    log.info("client connected to session", { id, requestId: options.requestId })
    session.subscribers.add(ws)
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
        session.process.write(String(message))
      },
      onClose: () => {
        log.info("client disconnected from session", { id, requestId: options.requestId })
        session.subscribers.delete(ws)
      },
    }
  }
}
