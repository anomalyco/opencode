export * as StreamWire from "./stream-wire.js"

export const STREAM_PROTOCOL_VERSION = 1 as const
export const FRAME_HEADER_BYTES = 10
/** Target payload size for outbound DATA frames: small enough for fair interleaving with HMR/control. */
export const FRAME_DATA_CHUNK_BYTES = 16 * 1024
/** Maximum payload accepted in any single frame. */
export const MAX_FRAME_PAYLOAD_BYTES = 64 * 1024
/** Hard WebSocket maxPayload cap including header overhead. */
export const MAX_WS_FRAME_BYTES = MAX_FRAME_PAYLOAD_BYTES + FRAME_HEADER_BYTES + 1024
/** Default server-side per-stream receive window for uploads (1.5 MiB). */
export const DEFAULT_STREAM_WINDOW_BYTES = 1536 * 1024
/**
 * Default desktop-side per-stream receive window for downloads (512 KiB; derives a 128 KiB credit batch).
 * Asymmetric against the 1.5 MiB server receive window to bound downstream queueing ahead of concurrent
 * interactive streams such as WebSocket echoes and HMR updates.
 */
export const DEFAULT_CLIENT_STREAM_WINDOW_BYTES = 512 * 1024
/** Hard upper bound on any stream window to prevent credit overflow attacks. */
export const MAX_STREAM_WINDOW_BYTES = 4 * 1024 * 1024
/** Bound WebSocket library write buffer so control/HMR frames are never buried behind a bulk download. */
export const MAX_WS_BUFFERED_BYTES = 256 * 1024
/** Hard cap on total buffered bytes across all streams of one attachment. */
export const MAX_ATTACHMENT_BUFFERED_BYTES = 8 * 1024 * 1024
/** Hard cap on concurrent streams per attachment. */
export const MAX_STREAMS_PER_ATTACHMENT = 128
/** Hard cap on concurrent in-flight TCP connects per attachment. */
export const MAX_PENDING_CONNECTS_PER_ATTACHMENT = 32

export const MAX_HOST_BYTES = 253
export const MAX_REASON_BYTES = 256

const HOST_PATTERN = /^[a-zA-Z0-9._:%-]+$/u
const encoder = new TextEncoder()
const decoder = new TextDecoder("utf-8", { fatal: true })

export const FrameType = {
  OPEN: 0x01,
  OPENED: 0x02,
  DATA: 0x03,
  WINDOW_UPDATE: 0x04,
  FIN: 0x05,
  RESET: 0x06,
  PING: 0x07,
  PONG: 0x08,
  GOAWAY: 0x09,
} as const

export const ResetCode = {
  CANCELLED: 0x0000,
  CONNECT_FAILED: 0x0001,
  POLICY_DENIED: 0x0002,
  LIMIT_EXCEEDED: 0x0003,
  PROTOCOL_ERROR: 0x0004,
  ATTACHMENT_CLOSED: 0x0005,
  INTERNAL_ERROR: 0x0006,
} as const

export type ResetCodeValue = (typeof ResetCode)[keyof typeof ResetCode]

export type Frame =
  | {
      readonly type: typeof FrameType.OPEN
      readonly streamID: number
      readonly host: string
      readonly port: number
      readonly initialWindow: number
    }
  | {
      readonly type: typeof FrameType.OPENED
      readonly streamID: number
      readonly initialWindow: number
    }
  | {
      readonly type: typeof FrameType.DATA
      readonly streamID: number
      readonly data: Uint8Array
    }
  | {
      readonly type: typeof FrameType.WINDOW_UPDATE
      readonly streamID: number
      readonly delta: number
    }
  | {
      readonly type: typeof FrameType.FIN
      readonly streamID: number
    }
  | {
      readonly type: typeof FrameType.RESET
      readonly streamID: number
      readonly code: ResetCodeValue
      readonly reason: string
    }
  | {
      readonly type: typeof FrameType.PING
      readonly token: Uint8Array
    }
  | {
      readonly type: typeof FrameType.PONG
      readonly token: Uint8Array
    }
  | {
      readonly type: typeof FrameType.GOAWAY
      readonly code: ResetCodeValue
      readonly reason: string
    }

export class WireProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WireProtocolError"
  }
}

export function encodeFrame(frame: Frame): Uint8Array {
  switch (frame.type) {
    case FrameType.OPEN: {
      assertStreamID(frame.streamID)
      assertPort(frame.port)
      assertWindow(frame.initialWindow)
      const hostBytes = encoder.encode(frame.host)
      if (hostBytes.byteLength < 1 || hostBytes.byteLength > MAX_HOST_BYTES || !HOST_PATTERN.test(frame.host)) {
        throw new WireProtocolError(`Invalid OPEN host: ${frame.host}`)
      }
      const payloadLength = 6 + hostBytes.byteLength
      const out = allocHeader(FrameType.OPEN, frame.streamID, payloadLength)
      const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
      view.setUint16(FRAME_HEADER_BYTES, frame.port, false)
      view.setUint32(FRAME_HEADER_BYTES + 2, frame.initialWindow, false)
      out.set(hostBytes, FRAME_HEADER_BYTES + 6)
      return out
    }
    case FrameType.OPENED: {
      assertStreamID(frame.streamID)
      assertWindow(frame.initialWindow)
      const out = allocHeader(FrameType.OPENED, frame.streamID, 4)
      const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
      view.setUint32(FRAME_HEADER_BYTES, frame.initialWindow, false)
      return out
    }
    case FrameType.DATA: {
      assertStreamID(frame.streamID)
      if (frame.data.byteLength < 1 || frame.data.byteLength > MAX_FRAME_PAYLOAD_BYTES) {
        throw new WireProtocolError(`Invalid DATA length: ${frame.data.byteLength}`)
      }
      const out = allocHeader(FrameType.DATA, frame.streamID, frame.data.byteLength)
      out.set(frame.data, FRAME_HEADER_BYTES)
      return out
    }
    case FrameType.WINDOW_UPDATE: {
      assertStreamID(frame.streamID)
      assertWindow(frame.delta)
      const out = allocHeader(FrameType.WINDOW_UPDATE, frame.streamID, 4)
      const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
      view.setUint32(FRAME_HEADER_BYTES, frame.delta, false)
      return out
    }
    case FrameType.FIN: {
      assertStreamID(frame.streamID)
      return allocHeader(FrameType.FIN, frame.streamID, 0)
    }
    case FrameType.RESET: {
      assertStreamID(frame.streamID)
      const reasonBytes = encoder.encode(frame.reason.slice(0, MAX_REASON_BYTES)).subarray(0, MAX_REASON_BYTES)
      const out = allocHeader(FrameType.RESET, frame.streamID, 2 + reasonBytes.byteLength)
      const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
      view.setUint16(FRAME_HEADER_BYTES, frame.code, false)
      out.set(reasonBytes, FRAME_HEADER_BYTES + 2)
      return out
    }
    case FrameType.PING:
    case FrameType.PONG: {
      if (frame.token.byteLength !== 8) throw new WireProtocolError("PING/PONG token must be 8 bytes.")
      const out = allocHeader(frame.type, 0, 8)
      out.set(frame.token, FRAME_HEADER_BYTES)
      return out
    }
    case FrameType.GOAWAY: {
      const reasonBytes = encoder.encode(frame.reason.slice(0, MAX_REASON_BYTES)).subarray(0, MAX_REASON_BYTES)
      const out = allocHeader(FrameType.GOAWAY, 0, 2 + reasonBytes.byteLength)
      const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
      view.setUint16(FRAME_HEADER_BYTES, frame.code, false)
      out.set(reasonBytes, FRAME_HEADER_BYTES + 2)
      return out
    }
  }
}

export function decodeFrame(raw: Uint8Array): Frame {
  if (raw.byteLength < FRAME_HEADER_BYTES) {
    throw new WireProtocolError(`Frame too short: ${raw.byteLength} bytes.`)
  }
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  const version = view.getUint8(0)
  if (version !== STREAM_PROTOCOL_VERSION) {
    throw new WireProtocolError(`Unsupported stream protocol version: ${version}.`)
  }
  const type = view.getUint8(1)
  const streamID = view.getUint32(2, false)
  const length = view.getUint32(6, false)
  if (length > MAX_FRAME_PAYLOAD_BYTES) {
    throw new WireProtocolError(`Frame payload exceeds limit: ${length} bytes.`)
  }
  if (raw.byteLength !== FRAME_HEADER_BYTES + length) {
    throw new WireProtocolError(`Frame length mismatch: header declares ${length}, actual ${raw.byteLength - FRAME_HEADER_BYTES}.`)
  }
  const payload = raw.subarray(FRAME_HEADER_BYTES)

  switch (type) {
    case FrameType.OPEN: {
      assertStreamID(streamID)
      if (length < 7 || length > 6 + MAX_HOST_BYTES) {
        throw new WireProtocolError(`Invalid OPEN payload length: ${length}.`)
      }
      const port = view.getUint16(FRAME_HEADER_BYTES, false)
      assertPort(port)
      const initialWindow = view.getUint32(FRAME_HEADER_BYTES + 2, false)
      assertWindow(initialWindow)
      const host = decodeUtf8(payload.subarray(6))
      if (host.length < 1 || host.length > MAX_HOST_BYTES || !HOST_PATTERN.test(host)) {
        throw new WireProtocolError("Invalid OPEN target host.")
      }
      return { type: FrameType.OPEN, streamID, host, port, initialWindow }
    }
    case FrameType.OPENED: {
      assertStreamID(streamID)
      if (length !== 4) throw new WireProtocolError(`Invalid OPENED payload length: ${length}.`)
      const initialWindow = view.getUint32(FRAME_HEADER_BYTES, false)
      assertWindow(initialWindow)
      return { type: FrameType.OPENED, streamID, initialWindow }
    }
    case FrameType.DATA: {
      assertStreamID(streamID)
      if (length < 1) throw new WireProtocolError("DATA frame must carry at least 1 byte.")
      // Copy slice so retaining the buffer does not pin a larger WebSocket slab.
      return { type: FrameType.DATA, streamID, data: new Uint8Array(payload) }
    }
    case FrameType.WINDOW_UPDATE: {
      assertStreamID(streamID)
      if (length !== 4) throw new WireProtocolError(`Invalid WINDOW_UPDATE payload length: ${length}.`)
      const delta = view.getUint32(FRAME_HEADER_BYTES, false)
      assertWindow(delta)
      return { type: FrameType.WINDOW_UPDATE, streamID, delta }
    }
    case FrameType.FIN: {
      assertStreamID(streamID)
      if (length !== 0) throw new WireProtocolError(`Invalid FIN payload length: ${length}.`)
      return { type: FrameType.FIN, streamID }
    }
    case FrameType.RESET: {
      assertStreamID(streamID)
      if (length < 2 || length > 2 + MAX_REASON_BYTES) {
        throw new WireProtocolError(`Invalid RESET payload length: ${length}.`)
      }
      const code = normalizeResetCode(view.getUint16(FRAME_HEADER_BYTES, false))
      const reason = length > 2 ? decodeUtf8(payload.subarray(2)) : ""
      return { type: FrameType.RESET, streamID, code, reason }
    }
    case FrameType.PING:
    case FrameType.PONG: {
      if (streamID !== 0) throw new WireProtocolError("PING/PONG must use streamID 0.")
      if (length !== 8) throw new WireProtocolError(`Invalid PING/PONG payload length: ${length}.`)
      return { type, token: new Uint8Array(payload) }
    }
    case FrameType.GOAWAY: {
      if (streamID !== 0) throw new WireProtocolError("GOAWAY must use streamID 0.")
      if (length < 2 || length > 2 + MAX_REASON_BYTES) {
        throw new WireProtocolError(`Invalid GOAWAY payload length: ${length}.`)
      }
      const code = normalizeResetCode(view.getUint16(FRAME_HEADER_BYTES, false))
      const reason = length > 2 ? decodeUtf8(payload.subarray(2)) : ""
      return { type: FrameType.GOAWAY, code, reason }
    }
    default:
      throw new WireProtocolError(`Unknown stream frame type: ${type}.`)
  }
}

function allocHeader(type: number, streamID: number, payloadLength: number) {
  const out = new Uint8Array(FRAME_HEADER_BYTES + payloadLength)
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
  view.setUint8(0, STREAM_PROTOCOL_VERSION)
  view.setUint8(1, type)
  view.setUint32(2, streamID, false)
  view.setUint32(6, payloadLength, false)
  return out
}

function assertStreamID(streamID: number) {
  if (!Number.isInteger(streamID) || streamID < 1 || streamID > 0xffffffff) {
    throw new WireProtocolError(`Invalid streamID: ${streamID}.`)
  }
}

function assertPort(port: number) {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new WireProtocolError(`Invalid port: ${port}.`)
  }
}

function assertWindow(bytes: number) {
  if (!Number.isInteger(bytes) || bytes < 1 || bytes > MAX_STREAM_WINDOW_BYTES) {
    throw new WireProtocolError(`Invalid window/credit size: ${bytes}.`)
  }
}

function normalizeResetCode(code: number): ResetCodeValue {
  switch (code) {
    case ResetCode.CANCELLED:
    case ResetCode.CONNECT_FAILED:
    case ResetCode.POLICY_DENIED:
    case ResetCode.LIMIT_EXCEEDED:
    case ResetCode.PROTOCOL_ERROR:
    case ResetCode.ATTACHMENT_CLOSED:
    case ResetCode.INTERNAL_ERROR:
      return code
    default:
      return ResetCode.INTERNAL_ERROR
  }
}

function decodeUtf8(bytes: Uint8Array) {
  try {
    return decoder.decode(bytes)
  } catch {
    throw new WireProtocolError("Frame contains invalid UTF-8.")
  }
}
