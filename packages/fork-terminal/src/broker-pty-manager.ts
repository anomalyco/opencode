import type { WSContext } from "hono/ws"
import * as BrokerPty from "./broker-pty"

export type BrokerPtyManager<Info extends { id: string }> = {
  list(): Info[]
  get(id: string): Info | undefined
  has(id: string): boolean
  set(info: Info): void
  delete(id: string): void
  create(
    sessionId: string,
    options?: { term?: string; cols?: number; rows?: number; env?: Record<string, string> },
    requestId?: string,
  ): Promise<BrokerPty.BrokerPtyInfo>
  resize(id: string, cols: number, rows: number, requestId?: string): Promise<void>
  kill(id: string, requestId?: string): Promise<void>
  write(id: string, data: string, requestId?: string): Promise<void>
  connect(
    id: string,
    ws: WSContext,
    options?: { requestId?: string },
  ): { onMessage: (msg: string | ArrayBuffer) => void; onClose: () => void } | undefined
  cleanup(): Promise<void>
}

type BrokerPtyManagerOptions<Info extends { id: string }> = {
  onExit?: (info: Info, reason?: { code?: string; error?: string }) => void
}

export function createBrokerPtyManager<Info extends { id: string }>(
  options: BrokerPtyManagerOptions<Info> = {},
): BrokerPtyManager<Info> {
  const state = new Map<string, Info>()

  BrokerPty.onExit((info, reason) => {
    const entry = state.get(info.id)
    if (!entry) return
    try {
      options.onExit?.(entry, reason)
    } catch {}
    state.delete(info.id)
  })

  return {
    list() {
      return Array.from(state.values())
    },
    get(id: string) {
      return state.get(id)
    },
    has(id: string) {
      return state.has(id)
    },
    set(info: Info) {
      state.set(info.id, info)
    },
    delete(id: string) {
      state.delete(id)
    },
    create(sessionId, options, requestId) {
      return BrokerPty.create(sessionId, options, requestId)
    },
    resize(id, cols, rows, requestId) {
      return BrokerPty.resize(id, cols, rows, requestId)
    },
    async kill(id: string, requestId?: string) {
      if (!state.has(id)) return
      await BrokerPty.kill(id, requestId)
      state.delete(id)
    },
    write(id, data, requestId) {
      return BrokerPty.write(id, data, requestId)
    },
    connect(id, ws, options) {
      return BrokerPty.connect(id, ws, options)
    },
    async cleanup() {
      const ids = Array.from(state.keys())
      for (const id of ids) {
        try {
          await BrokerPty.kill(id)
        } catch {}
      }
      state.clear()
    },
  }
}
