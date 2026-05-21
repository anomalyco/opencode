import type { AwarenessSource, BlobSource, DocSource } from "@blocksuite/sync"
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

  subscribe(cb: (docId: string, data: Uint8Array) => void, _disconnect: (reason: string) => void) {
    const next = url(this.opts, `/doc/${this.opts.docID}/connect`)
    next.searchParams.set("kind", "doc")
    next.protocol = next.protocol === "https:" ? "wss:" : "ws:"
    let done = false
    let closed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let poll: ReturnType<typeof setInterval> | undefined
    let pulling = false
    let ready: ((stop: () => void) => void) | undefined
    let synced: (() => void) | undefined
    let ws: WebSocket | undefined
    const docs = new Set([this.opts.docID])
    this.ready = new Promise<void>((resolve) => {
      synced = resolve
    })

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
        docs.add(msg.guid)
        cb(msg.guid, msg.data)
        return
      }
      if (raw[0] === MSG_DOC) cb(this.opts.docID, raw.subarray(1))
    }

    const stop = () => {
      closed = true
      if (timer) clearTimeout(timer)
      if (poll) clearInterval(poll)
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

    const pull = () => {
      if (closed || pulling) return
      pulling = true
      const ids = Array.from(docs).filter((id) => id !== this.opts.docID)
      void Promise.all([this.pull(this.opts.docID, new Uint8Array()), ...ids.map((id) => this.pull(id, new Uint8Array()))])
        .then(([root, ...rest]) => {
          if (closed) return
          if (root?.data.length) cb(this.opts.docID, root.data)
          rest.forEach((doc, i) => {
            if (doc?.data.length) cb(ids[i]!, doc.data)
          })
        })
        .finally(() => {
          synced?.()
          synced = undefined
          pulling = false
        })
    }

    connect()
    pull()
    poll = setInterval(pull, 750)

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

  async get(key: string) {
    const res = await this.opts.fetch(url(this.opts, `/doc/${this.opts.docID}/asset/${encodeURIComponent(key)}`), {
      cache: "no-store",
    })
    if (res.status === 404) return null
    if (!res.ok) throw new Error("doc asset fetch failed")
    return res.blob()
  }

  async set(key: string, value: Blob) {
    const res = await this.opts.fetch(url(this.opts, `/doc/${this.opts.docID}/asset`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: key,
        mime: value.type || "image/png",
        data: await blobB64(value),
      }),
    })
    if (!res.ok) throw new Error("doc asset upload failed")
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
