import type { AwarenessSource, BlobSource, DocSource } from "@blocksuite/sync"
import type { OpencodeClient } from "@opencode-ai/sdk/v2/client"
import { MSG_AWARENESS, MSG_DOC, pack, unpack } from "./doc-sync-protocol"
import { apiUrl } from "@/utils/api-url"

export type DocSyncOpts = {
  docID: string
  baseUrl: string
  directory: string
  client: OpencodeClient
  actorID: string
  name?: string
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
  const next = apiUrl(opts.baseUrl, path)
  next.searchParams.set("directory", opts.directory)
  return next
}

async function blobB64(blob: Blob) {
  return b64(new Uint8Array(await blob.arrayBuffer()))
}

export class OpencodeDocSource implements DocSource {
  name = "opencode"
  ready = Promise.resolve()
  private ws?: WebSocket
  private unsub?: () => void

  constructor(private opts: DocSyncOpts) {}

  async pull(docId: string, state: Uint8Array) {
    const res = await this.opts.client.doc.sync.pull(
      {
        docID: this.opts.docID,
        directory: this.opts.directory,
        guid: docId,
        ...(state.length > 0 ? { state: b64(state) } : {}),
      },
      { cache: "no-store" },
    )
    const json = res.data
    if (!json) return null
    return {
      data: fromB64(json.data),
      state: json.state ? fromB64(json.state) : undefined,
    }
  }

  async push(docId: string, data: Uint8Array) {
    const ws = this.ws
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(pack(MSG_DOC, docId, data))
      return
    }
    await this.opts.client.doc.sync.push({
      docID: this.opts.docID,
      directory: this.opts.directory,
      data: b64(data),
      guid: docId,
    })
  }

  subscribe(cb: (docId: string, data: Uint8Array) => void, _disconnect: (reason: string) => void) {
    const next = url(this.opts, `/doc/${this.opts.docID}/connect`)
    next.searchParams.set("kind", "doc")
    next.protocol = next.protocol === "https:" ? "wss:" : "ws:"
    let done = false
    let closed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let ready: ((stop: () => void) => void) | undefined
    let ws: WebSocket | undefined
    this.ready = Promise.resolve()

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

    const stop = () => {
      closed = true
      if (timer) clearTimeout(timer)
      ws?.removeEventListener("message", onMsg)
      if (ws && ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) ws.close(1000)
      if (done) return
      done = true
      ready?.(stop)
    }
    this.unsub = stop

    const retry = () => {
      if (closed || timer) return
      timer = setTimeout(() => {
        timer = undefined
        connect()
      }, 250)
    }

    const connect = () => {
      if (closed) return
      const socket = new WebSocket(next)
      socket.binaryType = "arraybuffer"
      ws = socket
      this.ws = socket
      socket.addEventListener("message", onMsg)
      socket.addEventListener("open", () => {
        if (done) return
        done = true
        ready?.(stop)
      })
      socket.addEventListener("close", () => {
        if (ws === socket) this.ws = undefined
        retry()
      })
      socket.addEventListener("error", () => {
        if (socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) socket.close()
        retry()
      })
    }

    connect()

    return new Promise<() => void>((resolve) => {
      if (done) {
        resolve(stop)
        return
      }
      ready = resolve
    })
  }

  close() {
    this.unsub?.()
    this.unsub = undefined
    this.ws = undefined
  }
}

export class OpencodeBlobSource implements BlobSource {
  name = "opencode-blob"
  readonly = false

  constructor(private opts: DocSyncOpts) {}

  async get(key: string): Promise<Blob | null> {
    const res = await this.opts.client.doc.asset.get(
      {
        docID: this.opts.docID,
        assetID: key,
        directory: this.opts.directory,
      },
      { cache: "no-store", parseAs: "blob", throwOnError: false },
    )
    if (res.error) {
      if (res.response.status === 404) return null
      throw new Error("doc asset fetch failed")
    }
    return (res.data as Blob | undefined) ?? null
  }

  async set(key: string, value: Blob) {
    await this.opts.client.doc.asset.create({
      docID: this.opts.docID,
      directory: this.opts.directory,
      id: key,
      mime: value.type || "application/octet-stream",
      data: await blobB64(value),
    })
    return key
  }

  async delete(_key: string) {}

  async list() {
    return []
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
    next.searchParams.set("kind", "awareness")
    next.protocol = next.protocol === "https:" ? "wss:" : "ws:"
    let closed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let ws: WebSocket | undefined

    const onUpdate = (
      changes: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown,
    ) => {
      if (origin === "remote") return
      if (ws?.readyState !== WebSocket.OPEN) return
      const changed = changes.added.concat(changes.updated, changes.removed)
      if (changed.length === 0) return
      void import("y-protocols/awareness").then((mod) => {
        const update = mod.encodeAwarenessUpdate(awareness, changed)
        ws?.send(pack(MSG_AWARENESS, "", update))
      })
    }

    awareness.on("update", onUpdate)

    const onMsg = (event: MessageEvent) => {
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
    }

    const retry = () => {
      if (closed || timer) return
      timer = setTimeout(() => {
        timer = undefined
        connect()
      }, 250)
    }

    const connect = () => {
      if (closed) return
      const socket = new WebSocket(next)
      socket.binaryType = "arraybuffer"
      ws = socket
      this.ws = socket
      socket.addEventListener("open", () => {
        void import("y-protocols/awareness").then((mod) => {
          socket.send(pack(MSG_AWARENESS, "", mod.encodeAwarenessUpdate(awareness, [awareness.clientID])))
        })
      })
      socket.addEventListener("message", onMsg)
      socket.addEventListener("close", () => {
        if (ws === socket) this.ws = undefined
        retry()
      })
      socket.addEventListener("error", () => {
        if (socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) socket.close()
        retry()
      })
    }

    connect()

    this.stop = () => {
      closed = true
      if (timer) clearTimeout(timer)
      if (ws?.readyState === WebSocket.OPEN) awareness.setLocalState(null)
      awareness.off("update", onUpdate)
      if (ws && ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) ws.close(1000)
    }
  }

  disconnect() {
    this.stop?.()
    this.stop = undefined
    this.ws = undefined
    this.awareness = undefined
  }
}
