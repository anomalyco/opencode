/**
 * Binary frame encoding/decoding — COB-37 §3 wire protocol
 *
 * Frame layout (per spec):
 *   [1] version = 0x01
 *   [1] flags   = 0x00 (bit 0 = encoding: 0=JSON, 1=msgpack)
 *   [2] type_len (little-endian)
 *   [type_len] UTF-8 event type
 *   [rest] msgpack-encoded properties (upgraded from JSON)
 */

import { encode as msgpackEncode, decode as msgpackDecode } from "@msgpack/msgpack"

const enc = new TextEncoder()
const dec = new TextDecoder()

const FLAGS_MSGPACK = 0x01

function packProps(props: unknown): Uint8Array {
  return msgpackEncode(props)
}

function unpackProps(bytes: Uint8Array, flags: number): unknown {
  if (bytes.byteLength === 0) return {}
  if (flags & FLAGS_MSGPACK) {
    return msgpackDecode(bytes)
  }
  // Backward compat: decode JSON for flags=0x00 frames
  return JSON.parse(dec.decode(bytes))
}

export function encodeFrame(event: { type: string; properties: unknown }): Uint8Array {
  const typeBytes = enc.encode(event.type)
  const propsBytes = packProps(event.properties)
  // [1 version][1 flags][2 type_len LE][type_len type][props]
  const frame = new Uint8Array(4 + typeBytes.byteLength + propsBytes.byteLength)
  frame[0] = 0x01 // version
  frame[1] = FLAGS_MSGPACK // flags: bit 0 = msgpack
  frame[2] = typeBytes.byteLength & 0xff
  frame[3] = (typeBytes.byteLength >> 8) & 0xff
  frame.set(typeBytes, 4)
  frame.set(propsBytes, 4 + typeBytes.byteLength)
  return frame
}

export function decodeFrame(frame: Uint8Array): { type: string; properties: unknown } {
  if (frame.byteLength < 4) throw new Error("frame too short")
  // version = frame[0] (currently 0x01)
  const flags = frame[1] // flags: bit 0 = encoding (0=JSON, 1=msgpack)
  const typeLen = frame[2] | (frame[3] << 8)
  if (4 + typeLen > frame.byteLength) throw new Error(`truncated frame: type_len=${typeLen} exceeds buffer`)
  const type = dec.decode(frame.slice(4, 4 + typeLen))
  const propsBytes = frame.slice(4 + typeLen)
  const properties = unpackProps(propsBytes, flags)
  return { type, properties }
}
