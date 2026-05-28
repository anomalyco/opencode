export const MSG_DOC = 0
export const MSG_AWARENESS = 1

export function pack(type: number, guid: string, data: Uint8Array) {
  const g = new TextEncoder().encode(guid)
  const out = new Uint8Array(1 + 2 + g.length + data.length)
  out[0] = type
  out[1] = (g.length >> 8) & 255
  out[2] = g.length & 255
  out.set(g, 3)
  out.set(data, 3 + g.length)
  return out
}

export function unpack(buf: Uint8Array) {
  if (buf.length < 3) return
  const type = buf[0]!
  const len = (buf[1]! << 8) | buf[2]!
  if (buf.length < 3 + len) return
  const guid = new TextDecoder().decode(buf.subarray(3, 3 + len))
  const data = buf.subarray(3 + len)
  return { type, guid, data }
}
