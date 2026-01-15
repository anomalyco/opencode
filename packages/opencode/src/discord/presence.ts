import { Session } from "../session"
import { Bus } from "../bus"
import { Config } from "../config/config"
import { Log } from "../util/log"
import { MessageV2 } from "../session/message-v2"
import { SessionStatus } from "../session/status"

export namespace DiscordPresence {
  export type Activity = {
    details?: string
    state?: string
    startTimestamp?: number
    buttons?: Array<{ label: string; url: string }>
  }

  export type Config = {
    showSessionDuration?: boolean
    showModel?: boolean
    showTool?: boolean
    buttons?: {
      session?: boolean
    }
  }

  export interface Client {
    connect(): Promise<void>
    setActivity(activity: Activity): Promise<void>
    clearActivity(): Promise<void>
    destroy(): Promise<void>
  }

  export class TestClient implements Client {
    activities: Activity[] = []
    cleared = 0
    connected = 0
    destroyed = 0

    async connect() {
      this.connected += 1
    }

    async setActivity(activity: Activity) {
      this.activities.push(activity)
    }

    async clearActivity() {
      this.cleared += 1
    }

    async destroy() {
      this.destroyed += 1
    }
  }

  export class Manager {
    private sessionInfo = new Map<string, Session.Info>()
    private sessionModel = new Map<string, { providerID: string; modelID: string }>()
    private sessionTool = new Map<string, string>()
    private sessionStatus = new Map<string, SessionStatus.Info>()
    private activeSessionID?: string

    constructor(
      private options: {
        client: Client
        config?: Config
      },
    ) {}

    handleSession(info: Session.Info) {
      this.sessionInfo.set(info.id, info)
      void this.refresh(info.id)
    }

    handleModel(sessionID: string, model: { providerID: string; modelID: string }) {
      this.sessionModel.set(sessionID, model)
      void this.refresh(sessionID)
    }

    handleTool(sessionID: string, tool?: string) {
      if (tool) {
        this.sessionTool.set(sessionID, tool)
      } else {
        this.sessionTool.delete(sessionID)
      }
      void this.refresh(sessionID)
    }

    handleSessionRemoved(sessionID: string) {
      this.sessionInfo.delete(sessionID)
      this.sessionModel.delete(sessionID)
      this.sessionTool.delete(sessionID)
      this.sessionStatus.delete(sessionID)
      if (this.activeSessionID === sessionID) this.activeSessionID = undefined
    }

    async handleStatus(sessionID: string, status: SessionStatus.Info) {
      if (status.type === "idle") {
        this.sessionStatus.delete(sessionID)
      } else {
        this.sessionStatus.set(sessionID, status)
      }

      const next = this.selectActiveSession(sessionID)
      if (!next) {
        this.activeSessionID = undefined
        await this.options.client.clearActivity()
        return
      }

      this.activeSessionID = next
      await this.updatePresence(next)
    }

    private selectActiveSession(preferred?: string) {
      if (preferred && this.sessionStatus.has(preferred)) return preferred
      if (this.activeSessionID && this.sessionStatus.has(this.activeSessionID)) return this.activeSessionID

      let best: { id: string; updated: number } | undefined
      for (const id of Array.from(this.sessionStatus.keys())) {
        const info = this.sessionInfo.get(id)
        const updated = info?.time.updated ?? 0
        if (!best || updated > best.updated) {
          best = { id, updated }
        }
      }
      return best?.id
    }

    private async refresh(sessionID: string) {
      if (this.activeSessionID !== sessionID) return
      await this.updatePresence(sessionID)
    }

    private async updatePresence(sessionID: string) {
      const info = this.sessionInfo.get(sessionID)
      if (!info) return

      const model = this.sessionModel.get(sessionID)
      const tool = this.sessionTool.get(sessionID)
      const status = this.sessionStatus.get(sessionID)
      const stateParts = [] as string[]
      const buttons = [] as Activity["buttons"]

      if (this.options.config?.showModel && model) {
        stateParts.push(`Model: ${model.providerID}/${model.modelID}`)
      }

      if (status?.type === "retry") {
        stateParts.push(`Retrying: ${status.attempt}`)
      }

      if (this.options.config?.buttons?.session && info.share?.url) {
        buttons?.push({
          label: "Session",
          url: info.share.url,
        })
      }

      const details = this.options.config?.showTool && tool ? `Tool: ${tool}` : `Session: ${info.title}`

      await this.options.client.setActivity({
        details,
        state: stateParts.length ? stateParts.join(" • ") : undefined,
        startTimestamp: this.options.config?.showSessionDuration ? info.time.created : undefined,
        buttons: buttons?.length ? buttons : undefined,
      })
    }
  }

  type Settings = Config & {
    enabled?: boolean
    clientId?: string
    useDefaultClientId?: boolean
  }

  const DEFAULT_CONFIG: Config = {
    showModel: true,
    showSessionDuration: true,
    showTool: true,
    buttons: {
      session: true,
    },
  }

  export const DEFAULT_CLIENT_ID = "1461164063424778271"

  export function isEnabled(settings?: Settings) {
    return settings?.enabled !== false
  }

  export function resolveClientId(settings?: Settings) {
    if (settings?.clientId) return settings.clientId
    if (settings?.useDefaultClientId === false) return
    return DEFAULT_CLIENT_ID
  }

  const log = Log.create({ service: "discord-presence" })
  let started = false

  const ARRPC_PORT = 6463
  const ARRPC_URL = `ws://127.0.0.1:${ARRPC_PORT}`

  /** WebSocket client for arRPC (Vesktop, etc) */
  class ArRpcClient implements Client {
    private ws?: WebSocket
    private ready = false
    private pending?: Activity
    private nonceCounter = 0

    constructor(private clientId: string) {}

    async connect() {
      if (this.ws) return

      return new Promise<void>((resolve) => {
        try {
          const ws = new WebSocket(ARRPC_URL)
          this.ws = ws

          const timeout = setTimeout(() => {
            ws.close()
            resolve()
          }, 5000)

          ws.onopen = () => {
            ws.send(JSON.stringify({ v: 1, client_id: this.clientId }))
          }

          ws.onmessage = (event) => {
            try {
              const data = JSON.parse(event.data as string)
              if (data.evt === "READY") {
                clearTimeout(timeout)
                this.ready = true
                log.info("connected to discord via arRPC")
                if (this.pending) void this.setActivity(this.pending)
                resolve()
              }
            } catch {}
          }

          ws.onerror = () => {
            clearTimeout(timeout)
            resolve()
          }

          ws.onclose = () => {
            this.ready = false
            this.ws = undefined
          }
        } catch {
          resolve()
        }
      })
    }

    async setActivity(activity: Activity) {
      this.pending = activity
      if (!this.ready || !this.ws) return

      const rpcActivity: Record<string, unknown> = {
        details: activity.details,
        state: activity.state,
      }
      if (activity.startTimestamp) {
        rpcActivity.timestamps = { start: activity.startTimestamp }
      }
      if (activity.buttons?.length) {
        rpcActivity.buttons = activity.buttons
      }

      this.ws.send(
        JSON.stringify({
          cmd: "SET_ACTIVITY",
          args: { pid: process.pid, activity: rpcActivity },
          nonce: `n-${++this.nonceCounter}`,
        }),
      )
    }

    async clearActivity() {
      this.pending = undefined
      if (!this.ready || !this.ws) return

      this.ws.send(
        JSON.stringify({
          cmd: "SET_ACTIVITY",
          args: { pid: process.pid, activity: null },
          nonce: `n-${++this.nonceCounter}`,
        }),
      )
    }

    async destroy() {
      if (this.ws) {
        this.ws.close()
        this.ws = undefined
      }
      this.ready = false
      this.pending = undefined
    }
  }

  /** Check if arRPC WebSocket is available */
  async function isArRpcAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const ws = new WebSocket(ARRPC_URL)
        const timeout = setTimeout(() => {
          ws.close()
          resolve(false)
        }, 1000)

        ws.onopen = () => {
          clearTimeout(timeout)
          ws.close()
          resolve(true)
        }
        ws.onerror = () => {
          clearTimeout(timeout)
          resolve(false)
        }
      } catch {
        resolve(false)
      }
    })
  }

  /** IPC client for official Discord (discord-rpc package) */
  class IpcClient implements Client {
    private client?: {
      on: (event: string, listener: (...args: any[]) => void) => void
      login: (input: { clientId: string }) => Promise<void>
      setActivity: (activity: Activity) => Promise<void>
      clearActivity: () => Promise<void>
      destroy: () => Promise<void>
    }
    private ready = false
    private pending?: Activity
    private connecting = false

    constructor(private clientId: string) {}

    async connect() {
      if (this.client || this.connecting) return
      this.connecting = true
      try {
        const rpcModule = (await import("discord-rpc")) as any
        const ClientCtor = rpcModule?.Client ?? rpcModule?.default?.Client
        if (!ClientCtor) {
          throw new Error("discord-rpc Client not found")
        }

        const client = new ClientCtor({ transport: "ipc" })
        this.client = client
        client.on("ready", () => {
          this.ready = true
          log.info("connected to discord via IPC")
          if (this.pending) void this.setActivity(this.pending)
        })
        client.on("error", (error: unknown) => {
          log.warn("discord rpc error", {
            error: error instanceof Error ? error.message : String(error),
          })
        })
        await client.login({ clientId: this.clientId })
      } catch (error) {
        log.warn("discord rpc connect failed", {
          error: error instanceof Error ? error.message : String(error),
        })
      } finally {
        this.connecting = false
      }
    }

    async setActivity(activity: Activity) {
      this.pending = activity
      if (!this.ready || !this.client) return
      await this.client.setActivity(activity).catch((error: unknown) => {
        log.warn("discord rpc setActivity failed", {
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }

    async clearActivity() {
      this.pending = undefined
      if (!this.ready || !this.client) return
      await this.client.clearActivity().catch((error: unknown) => {
        log.warn("discord rpc clearActivity failed", {
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }

    async destroy() {
      if (!this.client) return
      await this.client.destroy().catch((error: unknown) => {
        log.warn("discord rpc destroy failed", {
          error: error instanceof Error ? error.message : String(error),
        })
      })
      this.client = undefined
      this.ready = false
      this.pending = undefined
    }
  }

  /** Create appropriate RPC client - tries arRPC first (Vesktop), falls back to IPC (official Discord) */
  async function createRpcClient(clientId: string): Promise<Client> {
    if (await isArRpcAvailable()) {
      log.info("arRPC detected, using WebSocket transport")
      return new ArRpcClient(clientId)
    }
    log.info("using IPC transport for Discord RPC")
    return new IpcClient(clientId)
  }

  function toManagerConfig(settings?: Settings): Config {
    const { enabled: _enabled, clientId: _clientId, useDefaultClientId: _useDefaultClientId, ...rest } = settings ?? {}
    return {
      ...DEFAULT_CONFIG,
      ...rest,
      buttons: {
        ...DEFAULT_CONFIG.buttons,
        ...rest.buttons,
      },
    }
  }

  export async function init() {
    if (started) return
    started = true
    const config = await Config.get()
    const settings = config.discord

    if (!isEnabled(settings)) return
    const clientId = resolveClientId(settings)
    if (!clientId) {
      log.warn("discord presence enabled without clientId")
      return
    }

    const client = await createRpcClient(clientId)
    const manager = new Manager({
      client,
      config: toManagerConfig(settings),
    })

    await client.connect()

    const unsubscribers: Array<() => void> = []

    unsubscribers.push(
      Bus.subscribe(Session.Event.Created, (event) => {
        manager.handleSession(event.properties.info)
      }),
    )

    unsubscribers.push(
      Bus.subscribe(Session.Event.Updated, (event) => {
        manager.handleSession(event.properties.info)
      }),
    )

    unsubscribers.push(
      Bus.subscribe(Session.Event.Deleted, (event) => {
        manager.handleSessionRemoved(event.properties.info.id)
      }),
    )

    unsubscribers.push(
      Bus.subscribe(SessionStatus.Event.Status, (event) => {
        void manager.handleStatus(event.properties.sessionID, event.properties.status)
      }),
    )

    unsubscribers.push(
      Bus.subscribe(MessageV2.Event.Updated, (event) => {
        const info = event.properties.info
        if (info.role === "user") {
          manager.handleModel(info.sessionID, info.model)
          return
        }
        manager.handleModel(info.sessionID, { providerID: info.providerID, modelID: info.modelID })
      }),
    )

    unsubscribers.push(
      Bus.subscribe(MessageV2.Event.PartUpdated, (event) => {
        const part = event.properties.part
        if (part.type !== "tool") return
        const title = ("title" in part.state ? part.state.title : undefined) ?? part.tool
        if (part.state.status === "running") {
          manager.handleTool(part.sessionID, title)
          return
        }
        if (part.state.status === "completed" || part.state.status === "error") {
          manager.handleTool(part.sessionID, undefined)
        }
      }),
    )

    const dispose = async () => {
      for (const unsub of unsubscribers) {
        unsub()
      }
      await client.clearActivity()
      await client.destroy()
    }

    unsubscribers.push(
      Bus.subscribe(Bus.InstanceDisposed, () => {
        void dispose()
      }),
    )
  }
}
