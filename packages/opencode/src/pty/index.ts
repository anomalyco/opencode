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
import { Global } from "@/global"
import { Provider } from "../provider/provider"
import { Config } from "../config/config"
import { Filesystem } from "@/util/filesystem"

export namespace Pty {
  const log = Log.create({ service: "pty" })

  const BUFFER_LIMIT = 1024 * 1024 * 2
  const BUFFER_CHUNK = 64 * 1024

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
    const env = { ...process.env, ...input.env, TERM: "xterm-256color" } as Record<string, string>

    let envExports = ""
    try {
      const statePath = `${Global.Path.state}/model.json`
      let recent: { providerID: string; modelID: string } | undefined
      if (await Filesystem.exists(statePath)) {
        const content = await Bun.file(statePath).text()
        const json = JSON.parse(content)
        if (json.recent && Array.isArray(json.recent) && json.recent.length > 0 && json.recent[0].providerID) {
          recent = json.recent[0]
        }
      }

      const config = await Config.get()
      const configModel = config.model

      let providerID: string
      let modelID: string

      if (recent) {
        providerID = recent.providerID
        modelID = recent.modelID
      } else if (configModel) {
        const parsed = Provider.parseModel(configModel)
        providerID = parsed.providerID
        modelID = parsed.modelID
      } else {
        const defaultModel = await Provider.defaultModel()
        providerID = defaultModel.providerID
        modelID = defaultModel.modelID
      }

      const model = await Provider.getModel(providerID, modelID)

      const canonicalModelID = model.id.split("/").pop() || model.id
      const escapedName = model.name.replace(/'/g, "'\\''")
      env["OPENCODE_MODEL_ID"] = model.id
      env["OPENCODE_CANONICAL_MODEL_ID"] = canonicalModelID
      env["OPENCODE_PROVIDER_ID"] = model.providerID
      env["OPENCODE_MODEL_FULL_ID"] = `${model.providerID}/${model.id}`
      env["OPENCODE_MODEL_NAME"] = model.name
      envExports = `export OPENCODE_MODEL_ID='${model.id}' OPENCODE_CANONICAL_MODEL_ID='${canonicalModelID}' OPENCODE_PROVIDER_ID='${model.providerID}' OPENCODE_MODEL_FULL_ID='${model.providerID}/${model.id}' OPENCODE_MODEL_NAME='${escapedName}'; `
    } catch (error) {}

    log.info("creating session", { id, cmd: command, args, cwd })

    const spawn = await pty()
    const spawnArgs = [...args]

    if (command.endsWith("sh") && spawnArgs.length > 0) {
      const cmdStr = spawnArgs[spawnArgs.length - 1]
      spawnArgs[spawnArgs.length - 1] = envExports + cmdStr
    }

    const ptyProcess = spawn(command, spawnArgs, {
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
        ws.close()
      }
      session.subscribers.clear()
      Bus.publish(Event.Exited, { id, exitCode })
      for (const ws of session.subscribers) {
        ws.close()
      }
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
        log.info("client disconnected from session", { id })
        session.subscribers.delete(ws)
      },
    }
  }
}
