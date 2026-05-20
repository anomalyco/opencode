import type { AwarenessSource, DocSource } from "@blocksuite/sync"
import { MSG_AWARENESS, MSG_DOC, pack, unpack } from "./doc-sync-protocol"

export type DocSyncOpts = {
  docID: string
  baseUrl: string
  directory: string
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  actorID: string
  name: string
  color: string
}

function b64(input: Uint8Array) {
  let binary = ""
  for (const byte of input) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromB64(value: string) {
  const binary = atob(value)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

function url(opts: DocSyncOpts, path: string) {
  const next = new URL(path, opts.baseUrl)
  next.searchParams.set("directory", opts.directory)
  return next
}

export class OpencodeDocSource implements DocSource {
  name = "opencode"
  private ws?: WebSocket
  private unsub?: () => void

  constructor(private opts: DocSyncOpts) {}

  async pull(docId: string, state: Uint8Array) {
    const next = url(this.opts, `/doc/${this.opts.docID}/sync`)
    next.searchParams.set("guid", docId)
    if (state.length > 0) next.searchParams.set("state", b64(state))
    const res = await this.opts.fetch(next, { cache: "no-store" })
    if (!res.ok) return null
    const json = (await res.json()) as { data: string; state?: string } | null
    if (!json) return null
    return {
      data: fromB64(json.data),
      state: json.state ? fromB64(json.state) : undefined,
    }
  }

  async push(docId: string, data: Uint8Array) {
    const res = await this.opts.fetch(url(this.opts, `/doc/${this.opts.docID}/sync`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: b64(data), guid: docId }),
    })
    if (!res.ok) throw new Error("doc sync push failed")
  }

  subscribe(cb: (docId: string, data: Uint8Array) => void, disconnect: (reason: string) => void) {
    const next = url(this.opts, `/doc/${this.opts.docID}/connect`)
    next.protocol = next.protocol === "https:" ? "wss:" : "ws:"
    const ws = new WebSocket(next)
    ws.binaryType = "arraybuffer"

    const onMsg = (event: MessageEvent) => {
      const raw =
        event.data instanceof ArrayBuffer
          ? new Uint8Array(event.data)
          : typeof event.data === "string"
            ? new TextEncoder().encode(event.data)
            : undefined
      if (!raw || raw.length === 0) return
      const msg = unpack(raw)
      if (msg?.type === MSG_DOC) {
        cb(msg.guid, msg.data)
        return
      }
      if (raw[0] === MSG_DOC) cb(this.opts.docID, raw.subarray(1))
    }

    ws.addEventListener("message", onMsg)
    ws.addEventListener("close", () => disconnect("closed"))
    ws.addEventListener("error", () => disconnect("error"))

    this.ws = ws
    this.unsub = () => {
      if (ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) ws.close(1000)
    }
    return this.unsub
  }

  close() {
    this.unsub?.()
    this.unsub = undefined
    this.ws = undefined
  }
}

export class OpencodeAwarenessSource implements AwarenessSource {
  name = "opencode-awareness"
  private awareness?: import("y-protocols/awareness").Awareness
  private ws?: WebSocket
  private stop?: () => void

  constructor(private opts: DocSyncOpts) {}

  connect(awareness: import("y-protocols/awareness").Awareness) {
    this.awareness = awareness
    const next = url(this.opts, `/doc/${this.opts.docID}/connect`)
    next.protocol = next.protocol === "https:" ? "wss:" : "ws:"
    const ws = new WebSocket(next)
    ws.binaryType = "arraybuffer"
    this.ws = ws

    const onUpdate = (
      changes: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown,
    ) => {
      if (origin === "remote") return
      if (ws.readyState !== WebSocket.OPEN) return
      const changed = changes.added.concat(changes.updated, changes.removed)
      if (changed.length === 0) return
      void import("y-protocols/awareness").then((mod) => {
        const update = mod.encodeAwarenessUpdate(awareness, changed)
        ws.send(pack(MSG_AWARENESS, "", update))
      })
    }

    awareness.on("update", onUpdate)

    ws.addEventListener("open", () => {
      void import("y-protocols/awareness").then((mod) => {
        ws.send(pack(MSG_AWARENESS, "", mod.encodeAwarenessUpdate(awareness, [awareness.clientID])))
      })
    })

    ws.addEventListener("message", (event) => {
      const raw =
        event.data instanceof ArrayBuffer
          ? new Uint8Array(event.data)
          : typeof event.data === "string"
            ? new TextEncoder().encode(event.data)
            : undefined
      if (!raw || raw.length === 0) return
      const msg = unpack(raw)
      const data = msg?.type === MSG_AWARENESS ? msg.data : raw[0] === MSG_AWARENESS ? raw.subarray(1) : undefined
      if (!data) return
      void import("y-protocols/awareness").then((mod) => {
        mod.applyAwarenessUpdate(awareness, data, "remote")
      })
    })

    this.stop = () => {
      if (ws.readyState === WebSocket.OPEN) awareness.setLocalState(null)
      awareness.off("update", onUpdate)
      if (ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) ws.close(1000)
    }
  }

  disconnect() {
    this.stop?.()
    this.stop = undefined
    this.ws = undefined
    this.awareness = undefined
  }
}
