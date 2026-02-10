/**
 * PTY Module (Claxedo Patched)
 *
 * This is a patched version of packages/opencode/src/pty/index.ts
 * that adds agent hooks integration for CLI agent lifecycle tracking.
 *
 * CHANGES FROM UPSTREAM:
 * - Import agent-hooks module
 * - Add agent hooks env vars when CLAXEDO_PORT is set
 */

import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { type IPty } from "bun-pty"
import z from "zod"
import { Identifier } from "@/id/id"
import { Log } from "@/util/log"
import type { WSContext } from "hono/ws"
import { Instance } from "@/project/instance"
import { lazy } from "@opencode-ai/util/lazy"
import { Shell } from "@/shell/shell"
// CLAXEDO PATCH: Import agent-hooks
import { getTerminalEnvVars, isSetupComplete, setupAgentHooks } from "@/agent-hooks"
// CLAXEDO PATCH: Persistent PTY replay history for reconnect/reload continuity
import { createDiskHistory } from "./history-disk"

const setup = { promise: undefined as Promise<void> | undefined }

async function ensureSetup(port: number) {
  if (isSetupComplete()) return true
  if (!setup.promise) {
    setup.promise = setupAgentHooks({ port })
      .catch(() => undefined)
      .finally(() => {
        setup.promise = undefined
      })
  }
  await setup.promise
  return isSetupComplete()
}

export namespace Pty {
  const log = Log.create({ service: "pty" })

  const BUFFER_LIMIT = 1024 * 1024 * 2
  // CLAXEDO PATCH: Keep a larger always-on replay tail (default 16 MiB).
  const HISTORY_LIMIT = (() => {
    const raw = Number(process.env.OPENCODE_PTY_HISTORY_LIMIT)
    if (!Number.isFinite(raw) || raw <= 0) return 1024 * 1024 * 16
    return Math.floor(raw)
  })()
  const BUFFER_CHUNK = 64 * 1024
  const DEBUG = process.env.OPENCODE_PTY_DEBUG === "1"
  // CLAXEDO PATCH: Debug flag for agent hooks integration
  const CLAXEDO_DEBUG = process.env.CLAXEDO_DEBUG === "1"

  export const osc7 = (buf: string, chunk: string) => {
    // OSC-7: ESC ] 7 ; file://hostname/path BEL  (or ST = ESC \\)
    const esc = "\x1b"
    const bel = "\x07"
    const prefix = `${esc}]7;file://`
    const max = 1024

    const data = buf + chunk

    let pos = 0
    let cwd: string | undefined
    for (;;) {
      const start = data.indexOf(prefix, pos)
      if (start === -1) break

      const from = start + prefix.length
      const belEnd = data.indexOf(bel, from)
      const st = `${esc}\\`
      const stEnd = data.indexOf(st, from)

      const end = (() => {
        if (belEnd === -1) return stEnd
        if (stEnd === -1) return belEnd
        return Math.min(belEnd, stEnd)
      })()

      if (end === -1) {
        const tail = data.slice(start)
        return {
          cwd,
          buf: tail.length <= max ? tail : "",
        }
      }

      const body = data.slice(from, end)
      const slash = body.indexOf("/")
      if (slash !== -1) {
        const raw = body.slice(slash)
        cwd = (() => {
          if (!raw.includes("%")) return raw
          try {
            return decodeURIComponent(raw)
          } catch {
            return raw
          }
        })()
      }

      pos = end + (end === stEnd ? st.length : 1)
    }

    const last = data.lastIndexOf(esc)
    if (last === -1) return { cwd, buf: "" }

    const tail = data.slice(last)
    if (!prefix.startsWith(tail)) return { cwd, buf: "" }
    return { cwd, buf: tail.length <= max ? tail : "" }
  }

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
    history: Awaited<ReturnType<typeof createDiskHistory>>
    osc7: string
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

  export function list() {
    return Array.from(state().values()).map((s) => s.info)
  }

  export function get(id: string) {
    return state().get(id)?.info
  }

  export async function create(input: CreateInput) {
    const id = Identifier.create("pty", false)
    const command = input.command || Shell.preferred()
    const args = input.args || []
    if (command.endsWith("sh")) {
      args.push("-l")
    }

    const cwd = input.cwd || Instance.directory
	  const env = {
	    ...process.env,
	    ...input.env,
	    TERM: "xterm-256color",
	    OPENCODE_TERMINAL: "1",
	  } as Record<string, string>

	  // CLAXEDO PATCH: Auto-inject agent hooks environment if CLAXEDO_PORT is set
	  // This enables CLI agents to report lifecycle events back to the server
	  const claxedoPort = env.CLAXEDO_PORT
	  const port = claxedoPort ? parseInt(claxedoPort, 10) || 7860 : 0

	  const setupComplete = claxedoPort ? await ensureSetup(port) : false

	  if (CLAXEDO_DEBUG && claxedoPort) {
	    log.info("Agent hooks check", {
	      CLAXEDO_PORT: claxedoPort,
	      isSetupComplete: setupComplete,
	      command,
	      id,
	    })
	  }

	  if (claxedoPort && setupComplete) {
	    // Use PTY ID as both tab and terminal identifier
	    // The frontend listener will find the tab by terminalId
	    const tabId = env.CLAXEDO_TAB_ID || id
	    const terminalId = env.CLAXEDO_TERMINAL_ID || id
	    const workspaceId = env.CLAXEDO_WORKSPACE_ID || cwd

	    if (CLAXEDO_DEBUG) {
	      log.info("Injecting agent hooks env", { tabId, terminalId, workspaceId, port })
	    }

      // Get full env vars including shell integration (ZDOTDIR/BASH_ENV)
      const agentEnv = getTerminalEnvVars({
        tabId,
        terminalId,
        workspaceId,
        port,
        shell: command,
      })

      if (CLAXEDO_DEBUG) {
        log.info("Agent hooks env vars", agentEnv)
      }

	      // Merge agent hooks env into the terminal env
	      Object.assign(env, agentEnv)
	  } else if (CLAXEDO_DEBUG && claxedoPort && !setupComplete) {
	    log.warn("Agent hooks not injected: setup incomplete", {
	      CLAXEDO_PORT: claxedoPort,
	    })
	  }

    if (process.platform === "win32") {
      env.LC_ALL = "C.UTF-8"
      env.LC_CTYPE = "C.UTF-8"
      env.LANG = "C.UTF-8"
    }
    log.info("creating session", { id, cmd: command, args, cwd })
    if (DEBUG) log.info("create input", input)

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
    const history = await createDiskHistory({ directory: cwd, id, limit: HISTORY_LIMIT })

    const session: ActiveSession = {
      info,
      process: ptyProcess,
      buffer: "",
      history,
      osc7: "",
      subscribers: new Set(),
    }
    state().set(id, session)
    ptyProcess.onData((data) => {
      session.history.append(data)
      const parsed = osc7(session.osc7, data)
      session.osc7 = parsed.buf
      if (parsed.cwd && parsed.cwd !== session.info.cwd) {
        session.info.cwd = parsed.cwd
        if (DEBUG) log.info("cwd updated", { id, cwd: parsed.cwd })
        Bus.publish(Event.Updated, { info: session.info })
      }

      let open = false
      for (const ws of session.subscribers) {
        if (ws.readyState !== 1) {
          session.subscribers.delete(ws)
          continue
        }
        try {
          ws.send(data)
          open = true
        } catch {
          session.subscribers.delete(ws)
          ws.close()
        }
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
        ws.close()
      }
      session.subscribers.clear()
      Bus.publish(Event.Exited, { id, exitCode })
      for (const ws of session.subscribers) {
        ws.close()
      }
      void session.history.clear()
      state().delete(id)
    })
    Bus.publish(Event.Created, { info })
    return info
  }

  export async function update(id: string, input: UpdateInput) {
    const session = state().get(id)
    if (!session) return
    if (input.title) {
      session.info.title = input.title
    }
    if (input.size) {
      session.process.resize(input.size.cols, input.size.rows)
    }
    Bus.publish(Event.Updated, { info: session.info })
    return session.info
  }

  export async function remove(id: string) {
    const session = state().get(id)
    if (!session) return
    log.info("removing session", { id })
    try {
      session.process.kill()
    } catch {}
    for (const ws of session.subscribers) {
      ws.close()
    }
    await session.history.clear()
    state().delete(id)
    Bus.publish(Event.Deleted, { id })
  }

  export function resize(id: string, cols: number, rows: number) {
    const session = state().get(id)
    if (session && session.info.status === "running") {
      session.process.resize(cols, rows)
    }
  }

  export function write(id: string, data: string) {
    const session = state().get(id)
    if (session && session.info.status === "running") {
      session.process.write(data)
    }
  }

  export function connect(id: string, ws: WSContext) {
    const session = state().get(id)
    if (!session) {
      ws.close()
      return
    }
    log.info("client connected to session", { id })
    session.subscribers.add(ws)
    const replay = session.history.snapshot()
    if (replay) {
      try {
        for (let i = 0; i < replay.length; i += BUFFER_CHUNK) {
          ws.send(replay.slice(i, i + BUFFER_CHUNK))
        }
      } catch {
        session.subscribers.delete(ws)
        ws.close()
        return
      }
    }
    return {
      onMessage: (message: string | ArrayBuffer) => {
        session.process.write(String(message))
      },
      onClose: () => {
        log.info("client disconnected from session", { id })
        session.subscribers.delete(ws)
      },
    }
  }
}
