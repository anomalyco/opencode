import type { RpcSerialization } from "effect/unstable/rpc"

// After a message this large the encoder is replaced so its grown target buffer can be collected.
export const ipcLargeMessageBytes = 1024 * 1024

// The MessagePack parser packs into one shared, grow-only target buffer and returns a view into it.
// Posting that view structured-clones the whole backing buffer, so after one large message every
// later message (even a 55-byte ack) would copy the full grown buffer across processes on each
// send. Encoding through this wrapper posts an exact-size copy instead. Decoding keeps a single
// parser for the connection: record structures the peer defined inline must stay known.
export function createIpcCodec(serialization: RpcSerialization.RpcSerialization["Service"]) {
  const decoder = serialization.makeUnsafe()
  let encoder = serialization.makeUnsafe()
  return {
    decode: (bytes: Uint8Array | string) => decoder.decode(bytes),
    encode(message: unknown) {
      const encoded = encoder.encode(message)
      if (!(encoded instanceof Uint8Array)) return encoded
      // Not `.slice()`: in the main process the packer hands out a Node Buffer, whose slice is a view.
      const copy = new Uint8Array(encoded)
      if (copy.byteLength > ipcLargeMessageBytes) encoder = serialization.makeUnsafe()
      return copy
    },
  }
}
