/**
 * Binary frame encoding/decoding — COB-37 §3 wire protocol
 *
 * Frame layout (per spec):
 *   [1] version = 0x01
 *   [1] flags   = 0x00
 *   [2] type_len (little-endian)
 *   [type_len] UTF-8 event type
 *   [rest] msgpack-encoded properties (Phase 1: JSON bytes as UTF-8)
 */

const enc = new TextEncoder()
const dec = new TextDecoder()

// Minimal msgpack: encode object as JSON bytes for Phase 1 (full msgpack in Phase 2)
function packProps(props: unknown): Uint8Array {
  return enc.encode(JSON.stringify(props))
}

function unpackProps(bytes: Uint8Array): unknown {
  if (bytes.byteLength === 0) return {}
  return JSON.parse(dec.decode(bytes))
}

export function encodeFrame(event: { type: string; properties: unknown }): Uint8Array {
  const typeBytes = enc.encode(event.type)
  const propsBytes = packProps(event.properties)
  // [1 version][1 flags][2 type_len LE][type_len type][props]
  const frame = new Uint8Array(4 + typeBytes.byteLength + propsBytes.byteLength)
  frame[0] = 0x01 // version
  frame[1] = 0x00 // flags
  frame[2] = typeBytes.byteLength & 0xff
  frame[3] = (typeBytes.byteLength >> 8) & 0xff
  frame.set(typeBytes, 4)
  frame.set(propsBytes, 4 + typeBytes.byteLength)
  return frame
}

export function decodeFrame(frame: Uint8Array): { type: string; properties: unknown } {
  if (frame.byteLength < 4) throw new Error("frame too short")
  // version = frame[0] (currently 0x01)
  // flags   = frame[1]
  const typeLen = frame[2] | (frame[3] << 8)
  if (4 + typeLen > frame.byteLength) throw new Error(`truncated frame: type_len=${typeLen} exceeds buffer`)
  const type = dec.decode(frame.slice(4, 4 + typeLen))
  const propsBytes = frame.slice(4 + typeLen)
  const properties = unpackProps(propsBytes)
  return { type, properties }
}
