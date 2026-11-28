// A Cloudflare Worker for machine-noise-workerd.test.ts: noise.ts unchanged, bundled for workerd's nodejs_compat with
// no shims. `POST /vectors` replays published vectors inside workerd; `/link` is a Durable Object that answers a
// Noise XX handshake as the responder over a WebSocket, then echoes every transport message back.
import { Noise } from "@opencode/core/machine/noise"
import { Result } from "effect"

declare const WebSocketPair: new () => { 0: WebSocket; 1: WebSocket & { accept: () => void } }

interface Vector {
  readonly init_prologue: string
  readonly init_static: string
  readonly init_ephemeral: string
  readonly resp_prologue: string
  readonly resp_static: string
  readonly resp_ephemeral: string
  readonly messages: ReadonlyArray<{ readonly payload: string }>
}

const hex = (value: string) => new Uint8Array(Buffer.from(value, "hex"))
const toHex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex")
const ok = <A>(result: Result.Result<A, Noise.Failure>) => Result.getOrThrow(result)
/** Plaintext the initiator sends to make both directions rekey after this message. */
const REKEY = "rekey"

/** Every message of `vector`, written by its sender and read back by its receiver, as ciphertext hex. */
const replay = (vector: Vector) => {
  const side = (initiator: boolean, prologue: string, s: string, e: string) =>
    ok(
      Noise.handshake({
        initiator,
        prologue: hex(prologue),
        static: ok(Noise.keyPair(hex(s))),
        ephemeral: ok(Noise.keyPair(hex(e))),
      }),
    )
  const initiator = side(true, vector.init_prologue, vector.init_static, vector.init_ephemeral)
  const responder = side(false, vector.resp_prologue, vector.resp_static, vector.resp_ephemeral)
  const handshake = vector.messages.slice(0, 3).map((message, index) => {
    const [sender, receiver] = index % 2 === 0 ? [initiator, responder] : [responder, initiator]
    const ciphertext = ok(sender.write(hex(message.payload)))
    if (toHex(ok(receiver.read(ciphertext))) !== message.payload) throw new Error("handshake payload mismatch")
    return toHex(ciphertext)
  })
  const [initiatorTransport, responderTransport] = [ok(initiator.split()), ok(responder.split())]
  const transport = vector.messages.slice(3).map((message, index) => {
    const [sender, receiver] =
      index % 2 === 0 ? [responderTransport, initiatorTransport] : [initiatorTransport, responderTransport]
    const ciphertext = ok(sender.send.encrypt(hex(message.payload)))
    if (toHex(ok(receiver.receive.decrypt(ciphertext))) !== message.payload)
      throw new Error("transport payload mismatch")
    return toHex(ciphertext)
  })
  return { ciphertexts: [...handshake, ...transport], hash: toHex(initiator.hash ?? new Uint8Array()) }
}

export class NoiseLink {
  fetch() {
    const pair = new WebSocketPair()
    const socket = pair[1]
    socket.accept()
    // This compatibility date delivers binary messages as a Blob unless asked otherwise.
    socket.binaryType = "arraybuffer"
    const noise = ok(
      Noise.handshake({ initiator: false, prologue: Buffer.from("opencode-workerd"), static: Noise.generateKeyPair() }),
    )
    let transport: Noise.Transport | undefined
    socket.addEventListener("message", (event) => {
      const message = new Uint8Array(event.data as ArrayBuffer)
      if (transport) {
        const plaintext = ok(transport.receive.decrypt(message))
        socket.send(ok(transport.send.encrypt(plaintext)))
        if (Buffer.from(plaintext).toString() !== REKEY) return
        transport.send.rekey()
        transport.receive.rekey()
        return
      }
      if (noise.hash === undefined) throw new Error("handshake failed")
      ok(noise.read(message))
      if (noise.remoteStatic === undefined) return socket.send(ok(noise.write(new Uint8Array(0))))
      transport = ok(noise.split())
      // The handshake hash, so the test can check that both sides ended in the same state.
      socket.send(ok(transport.send.encrypt(noise.hash ?? new Uint8Array())))
    })
    return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit)
  }
}

export default {
  async fetch(
    request: Request,
    env: {
      readonly LINK: {
        idFromName: (name: string) => unknown
        get: (id: unknown) => { fetch: (request: Request) => Promise<Response> }
      }
    },
  ) {
    if (new URL(request.url).pathname === "/link") return env.LINK.get(env.LINK.idFromName("link")).fetch(request)
    const vectors = (await request.json()) as ReadonlyArray<Vector>
    return Response.json(vectors.map(replay))
  },
}
