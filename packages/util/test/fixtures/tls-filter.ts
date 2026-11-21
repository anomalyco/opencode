// A TLS server behind a TCP relay that treats a large ClientHello the way the filtering networks in #60399 do. On those
// networks a ClientHello that spans two TCP segments (anything past about 1400 bytes) never reaches the server, while a
// ClientHello that fits one segment passes. The relay sees a byte stream, not segments, so it applies the same rule by
// size: it reads the first TLS record and drops or resets the connection when the record is larger than `LIMIT`.
import path from "node:path"

const LIMIT = 1200

const GROUPS: Record<number, string> = {
  0x0017: "P-256",
  0x0018: "P-384",
  0x001d: "X25519",
  0x11ec: "X25519MLKEM768",
}

export interface Hello {
  /** Size of the ClientHello on the wire, with its record header. */
  readonly bytes: number
  /** The groups the client sent a key share for. */
  readonly shares: ReadonlyArray<string>
  readonly passed: boolean
}

export type FilterMode = "drop" | "reset" | "pass"

interface Relay {
  upstream?: Bun.Socket
  hello?: Hello
  readonly pending: Uint8Array[]
}

const fixture = (name: string) => Bun.file(path.join(import.meta.dir, "tls", name)).text()

export async function tlsFilter(handler: (request: Request) => Response | Promise<Response>) {
  const ca = await fixture("localhost.cert.pem")
  const hellos: Hello[] = []
  const state: { mode: FilterMode } = { mode: "drop" }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    tls: { cert: ca, key: await fixture("localhost.key.pem") },
    fetch: handler,
  })
  const relay = Bun.listen<Relay>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        socket.data = { pending: [] }
      },
      data(socket, chunk) {
        if (socket.data.upstream) return void socket.data.upstream.write(chunk)
        socket.data.pending.push(Uint8Array.from(chunk))
        if (socket.data.hello) return
        const hello = parse(Buffer.concat(socket.data.pending), state.mode)
        if (!hello) return
        socket.data.hello = hello
        hellos.push(hello)
        if (hello.passed) return void forward(socket, server.port!)
        // A dropped ClientHello gets no answer at all; the connection stays open until the client gives up.
        if (state.mode === "reset") socket.terminate()
      },
      close(socket) {
        socket.data.upstream?.end()
      },
      error() {},
    },
  })
  return {
    ca,
    hellos,
    origin: `https://localhost:${relay.port}`,
    set mode(mode: FilterMode) {
      state.mode = mode
    },
    async [Symbol.asyncDispose]() {
      relay.stop(true)
      await server.stop(true)
    },
  }
}

async function forward(socket: Bun.Socket<Relay>, port: number) {
  const upstream = await Bun.connect({
    hostname: "127.0.0.1",
    port,
    socket: {
      data: (_, chunk) => void socket.write(chunk),
      close: () => void socket.end(),
      error: () => void socket.end(),
    },
  })
  socket.data.upstream = upstream
  socket.data.pending.splice(0).forEach((chunk) => upstream.write(chunk))
}

// Reads the record and handshake headers, skips to the extensions, and collects the key_share entries.
function parse(data: Buffer, mode: FilterMode): Hello | undefined {
  if (data.length < 5) return undefined
  const bytes = data.readUInt16BE(3) + 5
  if (data.length < bytes) return undefined
  const session = 9 + 2 + 32
  const ciphers = session + 1 + data[session]!
  const compression = ciphers + 2 + data.readUInt16BE(ciphers)
  const extensions = compression + 1 + data[compression]!
  const shares: string[] = []
  for (let at = extensions + 2; at + 4 <= bytes; at += 4 + data.readUInt16BE(at + 2)) {
    if (data.readUInt16BE(at) !== 0x0033) continue
    const end = at + 4 + data.readUInt16BE(at + 2)
    for (let entry = at + 6; entry + 4 <= end; entry += 4 + data.readUInt16BE(entry + 2)) {
      const group = data.readUInt16BE(entry)
      shares.push(GROUPS[group] ?? `0x${group.toString(16)}`)
    }
  }
  return { bytes, shares, passed: mode === "pass" || bytes <= LIMIT }
}
