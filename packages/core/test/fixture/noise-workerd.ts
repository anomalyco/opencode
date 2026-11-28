// A Cloudflare Worker for machine-noise-workerd.test.ts: noise.ts unchanged, bundled for workerd's nodejs_compat with
// no shims. `POST /vectors` replays published Noise XX vectors plus an empty-plaintext round-trip across a rekey.
import { Noise } from "@opencode/core/machine/noise"
import { Result } from "effect"

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
  // Guard empty-plaintext encrypt/decrypt (0-byte `update` throws in workerd AES-GCM) before and after rekey.
  for (const after of [false, true]) {
    if (after) {
      initiatorTransport.send.rekey()
      responderTransport.receive.rekey()
    }
    const empty = ok(initiatorTransport.send.encrypt(new Uint8Array(0)))
    if (ok(responderTransport.receive.decrypt(empty)).length !== 0) throw new Error("empty transport payload mismatch")
  }
  return { ciphertexts: [...handshake, ...transport], hash: toHex(initiator.hash ?? new Uint8Array()) }
}

export default {
  async fetch(request: Request) {
    const vectors = (await request.json()) as ReadonlyArray<Vector>
    return Response.json(vectors.map(replay))
  },
}
