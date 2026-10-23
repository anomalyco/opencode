const magic = [0x42, 0x43, 0x52, 0x44] as const
const version = 1
const finalFlag = 1
const headerLength = 20

export const maxRecordingFramePayloadBytes = 4 * 1024 * 1024

export type RecordingFrame = {
  readonly tabId: number
  readonly sequence: number
  readonly final: boolean
  readonly payload: Uint8Array
}

export function encodeRecordingFrame(frame: RecordingFrame): Uint8Array {
  validateUint32(frame.tabId, "tabId", true)
  validateUint32(frame.sequence, "sequence", false)
  if (frame.payload.byteLength > maxRecordingFramePayloadBytes) {
    throw new Error(`Recording frame payload exceeds ${maxRecordingFramePayloadBytes} bytes`)
  }
  if (frame.final && frame.payload.byteLength !== 0) throw new Error("Final recording frame must have an empty payload")
  if (!frame.final && frame.payload.byteLength === 0) throw new Error("Recording data frame must have a payload")
  const encoded = new Uint8Array(headerLength + frame.payload.byteLength)
  encoded.set(magic, 0)
  const view = new DataView(encoded.buffer)
  view.setUint8(4, version)
  view.setUint8(5, frame.final ? finalFlag : 0)
  view.setUint16(6, headerLength)
  view.setUint32(8, frame.tabId)
  view.setUint32(12, frame.sequence)
  view.setUint32(16, frame.payload.byteLength)
  encoded.set(frame.payload, headerLength)
  return encoded
}

export function decodeRecordingFrame(data: Uint8Array): RecordingFrame {
  if (data.byteLength < headerLength) throw new Error("Recording frame is shorter than its header")
  if (magic.some((byte, index) => data[index] !== byte)) throw new Error("Invalid recording frame magic")
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  if (view.getUint8(4) !== version) throw new Error(`Unsupported recording frame version: ${view.getUint8(4)}`)
  const flags = view.getUint8(5)
  if ((flags & ~finalFlag) !== 0) throw new Error(`Invalid recording frame flags: ${flags}`)
  if (view.getUint16(6) !== headerLength) throw new Error(`Invalid recording frame header length: ${view.getUint16(6)}`)
  const tabId = view.getUint32(8)
  const sequence = view.getUint32(12)
  const payloadLength = view.getUint32(16)
  if (tabId === 0) throw new Error("Recording frame tabId must be positive")
  if (payloadLength > maxRecordingFramePayloadBytes) {
    throw new Error(`Recording frame payload exceeds ${maxRecordingFramePayloadBytes} bytes`)
  }
  if (data.byteLength !== headerLength + payloadLength) throw new Error("Recording frame payload length does not match its header")
  const final = (flags & finalFlag) !== 0
  if (final && payloadLength !== 0) throw new Error("Final recording frame must have an empty payload")
  if (!final && payloadLength === 0) throw new Error("Recording data frame must have a payload")
  return { tabId, sequence, final, payload: data.subarray(headerLength) }
}

function validateUint32(value: number, field: string, positive: boolean): void {
  if (!Number.isInteger(value) || value < (positive ? 1 : 0) || value > 0xffff_ffff) {
    throw new Error(`Recording frame ${field} must be ${positive ? "a positive" : "an"} uint32`)
  }
}
