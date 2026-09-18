import { describe, expect, test } from "bun:test"
import { RpcSerialization } from "effect/unstable/rpc"
import { createIpcCodec, ipcLargeMessageBytes } from "./ipc-codec"

type Serialization = RpcSerialization.RpcSerialization["Service"]

const msgpack = RpcSerialization.makeMsgPack()

function counting(serialization: Serialization) {
  let created = 0
  const counted: Serialization = {
    ...serialization,
    makeUnsafe: () => {
      created++
      return serialization.makeUnsafe()
    },
  }
  return { created: () => created, serialization: counted }
}

describe("ipc codec", () => {
  test("posts an exact-size buffer instead of a view into the shared target", () => {
    const codec = createIpcCodec(msgpack)
    // The msgpack target starts at 8 KiB, so a view would drag a larger backing store along.
    const encoded = codec.encode({ _tag: "Request", id: "1", tag: "Ping", payload: {} })
    expect(encoded).toBeInstanceOf(Uint8Array)
    const bytes = encoded as Uint8Array
    expect(bytes.byteOffset).toBe(0)
    expect(bytes.buffer.byteLength).toBe(bytes.byteLength)
  })

  test("copies Node Buffers, whose slice is only a view", () => {
    const backing = new ArrayBuffer(1024 * 1024)
    const view = Buffer.from(backing, 16, 32)
    view.fill(7)
    const stub: Serialization = { ...msgpack, makeUnsafe: () => ({ decode: () => [], encode: () => view }) }
    const encoded = createIpcCodec(stub).encode({}) as Uint8Array
    expect(encoded.buffer).not.toBe(backing)
    expect(encoded.buffer.byteLength).toBe(32)
    expect([...encoded]).toEqual(Array(32).fill(7))
  })

  test("replaces the encoder after a large message and keeps the decoder", () => {
    const spy = counting(msgpack)
    const codec = createIpcCodec(spy.serialization)
    expect(spy.created()).toBe(2)
    codec.encode({ small: true })
    expect(spy.created()).toBe(2)
    codec.encode({ large: "x".repeat(ipcLargeMessageBytes) })
    expect(spy.created()).toBe(3)
    codec.decode(codec.encode({ after: 1 }) as Uint8Array)
    expect(spy.created()).toBe(3)
  })

  test("round-trips messages through the wrapped serialization", () => {
    const client = createIpcCodec(msgpack)
    const server = createIpcCodec(msgpack)
    const message = { _tag: "Request", id: "7", tag: "DraftsSet", payload: { key: "k", value: "v" } }
    expect(server.decode(client.encode(message) as Uint8Array)).toEqual([message])
  })
})
