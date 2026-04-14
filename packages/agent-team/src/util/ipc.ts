import path from "path"
import fs from "fs"
import { EventEmitter } from "events"

function encodeFrame(data: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(data) + "\n")
  const len = Buffer.alloc(4)
  len.writeUInt32BE(json.length, 0)
  return Buffer.concat([len, json])
}

function* decodeFrames(buf: Buffer): Generator<{ data: unknown; rest: Buffer }> {
  while (buf.length >= 4) {
    const len = buf.readUInt32BE(0)
    if (buf.length < 4 + len) return
    const json = buf.subarray(4, 4 + len).toString()
    const trimmed = json.replace(/\n$/, "")
    try {
      yield { data: JSON.parse(trimmed), rest: buf.subarray(4 + len) }
    } catch {
      return
    }
    buf = buf.subarray(4 + len)
  }
}

export class IPCServer extends EventEmitter {
  private socketPath: string
  private server: any
  private clients = new Map<string, { socket: any; buffer: Buffer }>()
  private nextId = 0

  constructor(socketPath: string) {
    super()
    this.socketPath = socketPath
  }

  async listen(): Promise<void> {
    await fs.promises.mkdir(path.dirname(this.socketPath), { recursive: true })
    try {
      await fs.promises.unlink(this.socketPath)
    } catch {}
    this.server = (Bun as any).listen({
      unix: this.socketPath,
      socket: {
        data: (socket: any, data: any) => {
          const clientId = socket.__clientId as string | undefined
          if (!clientId) return
          const client = this.clients.get(clientId)
          if (!client) return
          client.buffer = Buffer.concat([client.buffer, Buffer.from(data)])
          for (const { data: msg, rest } of decodeFrames(client.buffer)) {
            client.buffer = rest
            this.emit("message", clientId, msg)
          }
        },
        open: (socket: any) => {
          const id = `client-${this.nextId++}`
          socket.__clientId = id
          this.clients.set(id, { socket, buffer: Buffer.alloc(0) })
          this.emit("connect", id)
        },
        close: (socket: any) => {
          const clientId = socket.__clientId as string | undefined
          if (clientId) {
            this.clients.delete(clientId)
            this.emit("disconnect", clientId)
          }
        },
      },
    })
  }

  send(clientId: string, msg: unknown): void {
    const client = this.clients.get(clientId)
    if (!client) return
    client.socket.write(encodeFrame(msg))
  }

  broadcast(msg: unknown): void {
    const frame = encodeFrame(msg)
    for (const [, client] of this.clients) {
      client.socket.write(frame)
    }
  }

  get connectedClients(): string[] {
    return [...this.clients.keys()]
  }

  close(): void {
    this.server?.stop?.()
    try {
      fs.unlinkSync(this.socketPath)
    } catch {}
    this.clients.clear()
  }
}

export class IPCClient {
  private socketPath: string
  private socket: any = null
  private buffer: any = Buffer.alloc(0)
  private handler?: (msg: unknown) => void

  constructor(socketPath: string) {
    this.socketPath = socketPath
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      Bun.connect({
        unix: this.socketPath,
        socket: {
          data: (socket: any, data: any) => {
            this.buffer = Buffer.concat([this.buffer, Buffer.from(data)])
            for (const { data: msg, rest } of decodeFrames(this.buffer)) {
              this.buffer = rest
              this.handler?.(msg)
            }
          },
          error: (socket: any, err: any) => {},
          close: (socket: any) => {},
          open: (socket: any) => {
            this.socket = socket
            resolve()
          },
          connectError: (socket: any, err: any) => {
            reject(err)
          },
        },
      } as any)
    })
  }

  send(msg: unknown): void {
    if (!this.socket) throw new Error("Not connected")
    this.socket.write(encodeFrame(msg))
  }

  onMessage(handler: (msg: unknown) => void): void {
    this.handler = handler
  }

  close(): void {
    this.socket?.end?.()
    this.socket = null
  }
}
