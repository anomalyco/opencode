export * as StreamMux from "./stream-mux.js"

import { randomBytes } from "node:crypto"
import type { Socket } from "node:net"
import { Duplex } from "node:stream"
import { EgressPolicy } from "./egress-policy.js"
import type { Browser } from "./rpc.js"
import { StreamWire } from "./stream-wire.js"
import { BrowserTunnelHost } from "./tunnel-host.js"

export interface MuxOptions {
  /** Per-stream receive window advertised to peer. Default 1.5 MiB. */
  readonly streamWindowBytes?: number
  /** Batch threshold for sending WINDOW_UPDATE credits. Default min(256 KiB, window / 4). */
  readonly creditBatchBytes?: number
  /** Maximum DATA payload bytes per frame. Default 16 KiB. */
  readonly frameChunkBytes?: number
  /** Maximum bytes allowed in WebSocket library bufferedAmount for DATA frames. Default 256 KiB. */
  readonly maxWsBufferedBytes?: number
  /** Maximum concurrent streams for this attachment. Default 128. */
  readonly maxStreams?: number
  /** Maximum concurrent in-flight TCP connects for this attachment. Default 32. */
  readonly maxPendingConnects?: number
  /** Maximum total buffered bytes across all streams of this attachment. Default 8 MiB. */
  readonly maxAttachmentBufferedBytes?: number
  /** Per-stream outbound pause high-water mark. Default 256 KiB. */
  readonly streamOutboundHighWaterBytes?: number
  /** Heartbeat interval in milliseconds (0 disables heartbeat timer). Default 25000. */
  readonly heartbeatIntervalMs?: number
  /** Disconnect if peer is silent for longer than this (ms). Default 60000. */
  readonly heartbeatTimeoutMs?: number
  /** Cross-attachment global resource limits. */
  readonly globalLimits?: BrowserTunnelHost.GlobalLimits
}

export interface ServerMuxOptions extends MuxOptions {
  readonly policy: EgressPolicy.AttachmentPolicy
  /** TCP connect timeout per stream in milliseconds. Default 10000. */
  readonly connectTimeoutMs?: number
  /** Optional custom connector (for deterministic tests). */
  readonly connect?: (
    target: Browser.TunnelTarget,
    policy: EgressPolicy.AttachmentPolicy,
    options: { readonly signal?: AbortSignal; readonly timeoutMs?: number },
  ) => Promise<Socket>
}

export interface MuxCloseInfo {
  readonly code: number
  readonly reason: string
  readonly replaced: boolean
}

export interface ServerMux {
  readonly closed: Promise<MuxCloseInfo>
  readonly activeStreams: () => number
  readonly bufferedBytes: () => number
  close(code?: number, reason?: string): void
}

export interface ClientMux {
  readonly closed: Promise<MuxCloseInfo>
  readonly activeStreams: () => number
  readonly bufferedBytes: () => number
  readonly isClosed: () => boolean
  openStream(target: Browser.TunnelTarget, signal?: AbortSignal): Promise<Duplex>
  ping(): void
  close(code?: number, reason?: string): void
}

interface WritableStream {
  inRoundRobin: boolean
  hasWritableOutput(): boolean
  nextOutboundFrame(): Uint8Array | undefined
}

const WS_OPEN = 1
const MAX_INFLIGHT_WS_SENDS = 16
const DRAIN_RETRY_MS = 4

function resolveConfig(options: MuxOptions) {
  const streamWindowBytes = clamp(
    options.streamWindowBytes ?? StreamWire.DEFAULT_STREAM_WINDOW_BYTES,
    4096,
    StreamWire.MAX_STREAM_WINDOW_BYTES,
  )
  const creditBatchBytes = Math.max(
    1,
    Math.min(options.creditBatchBytes ?? Math.min(256 * 1024, Math.floor(streamWindowBytes / 4)), streamWindowBytes),
  )
  const frameChunkBytes = clamp(
    options.frameChunkBytes ?? StreamWire.FRAME_DATA_CHUNK_BYTES,
    1024,
    StreamWire.MAX_FRAME_PAYLOAD_BYTES,
  )
  const maxWsBufferedBytes = Math.max(frameChunkBytes, options.maxWsBufferedBytes ?? StreamWire.MAX_WS_BUFFERED_BYTES)
  const maxStreams = Math.max(1, options.maxStreams ?? StreamWire.MAX_STREAMS_PER_ATTACHMENT)
  const maxPendingConnects = Math.max(1, options.maxPendingConnects ?? StreamWire.MAX_PENDING_CONNECTS_PER_ATTACHMENT)
  const maxAttachmentBufferedBytes = Math.max(
    streamWindowBytes,
    options.maxAttachmentBufferedBytes ?? StreamWire.MAX_ATTACHMENT_BUFFERED_BYTES,
  )
  const streamOutboundHighWaterBytes = Math.max(
    frameChunkBytes,
    options.streamOutboundHighWaterBytes ?? Math.min(256 * 1024, streamWindowBytes),
  )
  const streamOutboundLowWaterBytes = Math.max(frameChunkBytes, Math.floor(streamOutboundHighWaterBytes / 2))
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 25_000
  const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 60_000
  const globalLimits = options.globalLimits ?? BrowserTunnelHost.defaultGlobalLimits

  return {
    streamWindowBytes,
    creditBatchBytes,
    frameChunkBytes,
    maxWsBufferedBytes,
    maxStreams,
    maxPendingConnects,
    maxAttachmentBufferedBytes,
    streamOutboundHighWaterBytes,
    streamOutboundLowWaterBytes,
    heartbeatIntervalMs,
    heartbeatTimeoutMs,
    globalLimits,
  }
}

/**
 * Single-writer frame scheduler:
 * - Always drains priority control frames first (OPEN, OPENED, WINDOW_UPDATE, RESET, PING, PONG, GOAWAY).
 * - Serves writable streams strictly round-robin, one bounded DATA frame per turn.
 * - Never pushes DATA frames once `socket.bufferedAmount >= maxWsBufferedBytes`, preventing a bulk
 *   download from burying interactive HMR/control traffic inside the WebSocket library or TCP send buffer.
 */
function createFrameWriter(
  socket: BrowserTunnelHost.BinarySocket,
  maxWsBufferedBytes: number,
  onWriteError: (error: Error) => void,
) {
  const controlQueue: Uint8Array[] = []
  const roundRobin: WritableStream[] = []
  let closed = false
  let inFlightSends = 0
  let pumping = false
  let drainTimer: ReturnType<typeof setTimeout> | undefined

  const scheduleDrainCheck = () => {
    if (closed || drainTimer) return
    drainTimer = setTimeout(() => {
      drainTimer = undefined
      pump()
    }, DRAIN_RETRY_MS)
    drainTimer.unref?.()
  }

  const pump = () => {
    if (closed || pumping || socket.readyState !== WS_OPEN) return
    pumping = true
    try {
      while (!closed && socket.readyState === WS_OPEN && inFlightSends < MAX_INFLIGHT_WS_SENDS) {
        const buffered = socket.bufferedAmount
        // Priority control frames (WINDOW_UPDATE, RESET, PING/PONG) may still transmit up to 2x cap
        // so neither side can deadlock waiting for credits while DATA is paused.
        if (controlQueue.length > 0 && (inFlightSends === 0 || buffered < maxWsBufferedBytes * 2)) {
          const frame = controlQueue.shift()!
          sendOne(frame)
          continue
        }
        if (buffered >= maxWsBufferedBytes) {
          scheduleDrainCheck()
          break
        }
        if (roundRobin.length === 0) break
        const stream = roundRobin.shift()!
        stream.inRoundRobin = false
        const frame = stream.nextOutboundFrame()
        if (stream.hasWritableOutput() && !stream.inRoundRobin) {
          stream.inRoundRobin = true
          roundRobin.push(stream)
        }
        if (frame) sendOne(frame)
      }
    } finally {
      pumping = false
    }
  }

  const sendOne = (frame: Uint8Array) => {
    inFlightSends += 1
    try {
      socket.send(frame, (error) => {
        inFlightSends = Math.max(0, inFlightSends - 1)
        if (error && !closed) {
          onWriteError(error)
          return
        }
        pump()
      })
    } catch (error) {
      inFlightSends = Math.max(0, inFlightSends - 1)
      onWriteError(asError(error))
    }
  }

  return {
    enqueueControl(frame: StreamWire.Frame) {
      if (closed) return
      controlQueue.push(StreamWire.encodeFrame(frame))
      pump()
    },
    markWritable(stream: WritableStream) {
      if (closed || stream.inRoundRobin || !stream.hasWritableOutput()) return
      stream.inRoundRobin = true
      roundRobin.push(stream)
      pump()
    },
    kick() {
      pump()
    },
    close() {
      closed = true
      controlQueue.length = 0
      roundRobin.length = 0
      if (drainTimer) {
        clearTimeout(drainTimer)
        drainTimer = undefined
      }
    },
  }
}

function startHeartbeat(
  socket: BrowserTunnelHost.BinarySocket,
  writer: ReturnType<typeof createFrameWriter>,
  intervalMs: number,
  timeoutMs: number,
  onTimeout: () => void,
) {
  let lastHeard = Date.now()
  const heard = () => {
    lastHeard = Date.now()
  }
  const offPong = socket.onPong?.(heard)
  let timer: ReturnType<typeof setInterval> | undefined
  if (intervalMs > 0) {
    timer = setInterval(() => {
      if (Date.now() - lastHeard > timeoutMs) {
        onTimeout()
        return
      }
      if (socket.readyState !== WS_OPEN) return
      socket.ping?.()
      writer.enqueueControl({ type: StreamWire.FrameType.PING, token: randomBytes(8) })
    }, intervalMs)
    timer.unref?.()
  }
  return {
    heard,
    stop() {
      if (timer) {
        clearInterval(timer)
        timer = undefined
      }
      offPong?.()
    },
  }
}

/**
 * Server-side multiplexed stream owner bound to one live desktop browser attachment.
 * Enforces egress policy, per-attachment and cross-attachment caps, credit-based flow control,
 * half-close, RESET cancellation, and clean teardown of every owned target TCP socket on close.
 */
export function createServerMux(socket: BrowserTunnelHost.BinarySocket, options: ServerMuxOptions): ServerMux {
  const cfg = resolveConfig(options)
  const connectTarget = options.connect ?? EgressPolicy.resolveAndConnect
  const closedDeferred = Promise.withResolvers<MuxCloseInfo>()
  let closed = false
  let attachmentBytes = 0
  let pendingConnects = 0

  type ServerStream = WritableStream & {
    readonly id: number
    status: "connecting" | "open" | "closed"
    readonly connectAbort: AbortController
    target?: Socket
    sendWindow: number
    recvWindow: number
    consumedSinceCredit: number
    inboundPendingBytes: number
    readonly outboundChunks: Uint8Array[]
    outboundOffset: number
    outboundBytes: number
    outboundFinPending: boolean
    outboundFinSent: boolean
    inboundFinReceived: boolean
    paused: boolean
  }

  const streams = new Map<number, ServerStream>()

  const reserveBytes = (bytes: number) => {
    if (bytes <= 0) return true
    if (attachmentBytes + bytes > cfg.maxAttachmentBufferedBytes) return false
    if (!cfg.globalLimits.tryReserveBytes(bytes)) return false
    attachmentBytes += bytes
    return true
  }

  const releaseBytes = (bytes: number) => {
    if (bytes <= 0) return
    attachmentBytes = Math.max(0, attachmentBytes - bytes)
    cfg.globalLimits.releaseBytes(bytes)
  }

  const writer = createFrameWriter(socket, cfg.maxWsBufferedBytes, () => {
    shutdown(1006, "write failed", false)
  })

  const heartbeat = startHeartbeat(socket, writer, cfg.heartbeatIntervalMs, cfg.heartbeatTimeoutMs, () => {
    shutdown(1001, "heartbeat timeout", true)
  })

  const cleanupStream = (stream: ServerStream, sendReset?: { readonly code: StreamWire.ResetCodeValue; readonly reason: string }) => {
    if (stream.status === "closed") return
    const wasConnecting = stream.status === "connecting"
    stream.status = "closed"
    streams.delete(stream.id)
    cfg.globalLimits.releaseStream()
    if (wasConnecting) {
      pendingConnects = Math.max(0, pendingConnects - 1)
      cfg.globalLimits.releasePendingConnect()
      stream.connectAbort.abort()
    }
    if (stream.inboundPendingBytes > 0) {
      releaseBytes(stream.inboundPendingBytes)
      stream.inboundPendingBytes = 0
    }
    if (stream.outboundBytes > 0) {
      releaseBytes(stream.outboundBytes)
      stream.outboundBytes = 0
    }
    stream.outboundChunks.length = 0
    stream.outboundOffset = 0
    stream.target?.destroy()
    stream.target = undefined
    if (sendReset && !closed) {
      writer.enqueueControl({
        type: StreamWire.FrameType.RESET,
        streamID: stream.id,
        code: sendReset.code,
        reason: sendReset.reason,
      })
    }
  }

  const maybeFinishStream = (stream: ServerStream) => {
    if (stream.status === "open" && stream.inboundFinReceived && stream.outboundFinSent) {
      cleanupStream(stream)
    }
  }

  const protocolFail = (reason: string) => {
    if (closed) return
    writer.enqueueControl({ type: StreamWire.FrameType.GOAWAY, code: StreamWire.ResetCode.PROTOCOL_ERROR, reason })
    shutdown(1002, reason, false)
  }

  const handleOpen = (frame: Extract<StreamWire.Frame, { readonly type: typeof StreamWire.FrameType.OPEN }>) => {
    if (streams.has(frame.streamID)) {
      protocolFail(`Duplicate streamID ${frame.streamID}.`)
      return
    }
    if (streams.size >= cfg.maxStreams || pendingConnects >= cfg.maxPendingConnects) {
      writer.enqueueControl({
        type: StreamWire.FrameType.RESET,
        streamID: frame.streamID,
        code: StreamWire.ResetCode.LIMIT_EXCEEDED,
        reason: "Browser attachment stream limit exceeded.",
      })
      return
    }
    if (!cfg.globalLimits.tryAcquireStream()) {
      writer.enqueueControl({
        type: StreamWire.FrameType.RESET,
        streamID: frame.streamID,
        code: StreamWire.ResetCode.LIMIT_EXCEEDED,
        reason: "Server browser stream capacity reached.",
      })
      return
    }
    if (!cfg.globalLimits.tryAcquirePendingConnect()) {
      cfg.globalLimits.releaseStream()
      writer.enqueueControl({
        type: StreamWire.FrameType.RESET,
        streamID: frame.streamID,
        code: StreamWire.ResetCode.LIMIT_EXCEEDED,
        reason: "Server pending connect capacity reached.",
      })
      return
    }
    pendingConnects += 1

    const stream: ServerStream = {
      id: frame.streamID,
      status: "connecting",
      connectAbort: new AbortController(),
      sendWindow: frame.initialWindow,
      recvWindow: cfg.streamWindowBytes,
      consumedSinceCredit: 0,
      inboundPendingBytes: 0,
      outboundChunks: [],
      outboundOffset: 0,
      outboundBytes: 0,
      outboundFinPending: false,
      outboundFinSent: false,
      inboundFinReceived: false,
      paused: false,
      inRoundRobin: false,
      hasWritableOutput() {
        if (stream.status !== "open") return false
        if (stream.outboundBytes > 0 && stream.sendWindow > 0) return true
        return stream.outboundBytes === 0 && stream.outboundFinPending && !stream.outboundFinSent
      },
      nextOutboundFrame() {
        if (stream.status !== "open") return undefined
        if (stream.outboundBytes > 0 && stream.sendWindow > 0) {
          const maxTake = Math.min(cfg.frameChunkBytes, stream.sendWindow)
          const slice = takeChunk(stream.outboundChunks, stream.outboundOffset, maxTake)
          stream.outboundOffset = slice.nextOffset
          stream.outboundBytes -= slice.bytes.byteLength
          stream.sendWindow -= slice.bytes.byteLength
          releaseBytes(slice.bytes.byteLength)
          if (stream.paused && stream.outboundBytes <= cfg.streamOutboundLowWaterBytes && stream.sendWindow > 0) {
            stream.paused = false
            stream.target?.resume()
          }
          return StreamWire.encodeFrame({
            type: StreamWire.FrameType.DATA,
            streamID: stream.id,
            data: slice.bytes,
          })
        }
        if (stream.outboundBytes === 0 && stream.outboundFinPending && !stream.outboundFinSent) {
          stream.outboundFinSent = true
          const encoded = StreamWire.encodeFrame({ type: StreamWire.FrameType.FIN, streamID: stream.id })
          maybeFinishStream(stream)
          return encoded
        }
        return undefined
      },
    }
    streams.set(stream.id, stream)

    void connectTarget(
      { host: frame.host, port: frame.port },
      options.policy,
      { signal: stream.connectAbort.signal, timeoutMs: options.connectTimeoutMs ?? 10_000 },
    ).then(
      (targetSocket) => {
        if (closed || stream.status !== "connecting") {
          targetSocket.destroy()
          return
        }
        pendingConnects = Math.max(0, pendingConnects - 1)
        cfg.globalLimits.releasePendingConnect()
        stream.status = "open"
        stream.target = targetSocket

        writer.enqueueControl({
          type: StreamWire.FrameType.OPENED,
          streamID: stream.id,
          initialWindow: stream.recvWindow,
        })

        targetSocket.on("data", (chunk: Buffer) => {
          if (closed || stream.status !== "open") return
          const copy = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength).slice()
          if (!reserveBytes(copy.byteLength)) {
            cleanupStream(stream, {
              code: StreamWire.ResetCode.LIMIT_EXCEEDED,
              reason: "Attachment buffer limit exceeded.",
            })
            return
          }
          stream.outboundChunks.push(copy)
          stream.outboundBytes += copy.byteLength
          if (stream.outboundBytes >= cfg.streamOutboundHighWaterBytes || stream.sendWindow === 0) {
            stream.paused = true
            targetSocket.pause()
          }
          writer.markWritable(stream)
        })

        targetSocket.once("end", () => {
          if (closed || stream.status !== "open") return
          stream.outboundFinPending = true
          writer.markWritable(stream)
        })

        targetSocket.on("error", (error: Error) => {
          if (closed || stream.status !== "open") return
          cleanupStream(stream, { code: StreamWire.ResetCode.INTERNAL_ERROR, reason: error.message.slice(0, 200) })
        })

        targetSocket.once("close", (hadError: boolean) => {
          if (closed || stream.status !== "open") return
          if (hadError) {
            cleanupStream(stream, { code: StreamWire.ResetCode.INTERNAL_ERROR, reason: "Target socket closed with error." })
            return
          }
          if (!stream.outboundFinPending && !stream.outboundFinSent) {
            stream.outboundFinPending = true
            writer.markWritable(stream)
          }
        })
      },
      (cause: unknown) => {
        if (closed || stream.status !== "connecting") return
        const error = asError(cause)
        const code =
          error instanceof EgressPolicy.EgressDeniedError
            ? StreamWire.ResetCode.POLICY_DENIED
            : StreamWire.ResetCode.CONNECT_FAILED
        cleanupStream(stream, { code, reason: error.message.slice(0, 200) })
      },
    )
  }

  const handleData = (frame: Extract<StreamWire.Frame, { readonly type: typeof StreamWire.FrameType.DATA }>) => {
    const stream = streams.get(frame.streamID)
    if (!stream) return
    if (stream.status !== "open" || !stream.target || stream.inboundFinReceived) {
      cleanupStream(stream, { code: StreamWire.ResetCode.PROTOCOL_ERROR, reason: "DATA on non-writable stream." })
      return
    }
    const len = frame.data.byteLength
    if (len > stream.recvWindow) {
      cleanupStream(stream, { code: StreamWire.ResetCode.PROTOCOL_ERROR, reason: "Stream receive window exceeded." })
      return
    }
    if (!reserveBytes(len)) {
      cleanupStream(stream, { code: StreamWire.ResetCode.LIMIT_EXCEEDED, reason: "Attachment inbound buffer limit exceeded." })
      return
    }
    stream.recvWindow -= len
    stream.inboundPendingBytes += len
    let drained = false
    // Never block the shared WS reader: hand bytes to target TCP socket and replenish credits
    // in batches once the target socket drains them.
    stream.target.write(frame.data, (error) => {
      if (drained) return
      drained = true
      if (stream.inboundPendingBytes >= len) {
        stream.inboundPendingBytes -= len
        releaseBytes(len)
      }
      if (closed || stream.status !== "open") return
      if (error) {
        cleanupStream(stream, { code: StreamWire.ResetCode.INTERNAL_ERROR, reason: error.message.slice(0, 200) })
        return
      }
      stream.consumedSinceCredit += len
      if (!stream.inboundFinReceived && stream.consumedSinceCredit >= cfg.creditBatchBytes) {
        const delta = stream.consumedSinceCredit
        stream.consumedSinceCredit = 0
        stream.recvWindow += delta
        writer.enqueueControl({ type: StreamWire.FrameType.WINDOW_UPDATE, streamID: stream.id, delta })
      }
    })
  }

  const handleWindowUpdate = (
    frame: Extract<StreamWire.Frame, { readonly type: typeof StreamWire.FrameType.WINDOW_UPDATE }>,
  ) => {
    const stream = streams.get(frame.streamID)
    if (!stream || stream.status === "closed") return
    if (stream.sendWindow + frame.delta > StreamWire.MAX_STREAM_WINDOW_BYTES) {
      cleanupStream(stream, { code: StreamWire.ResetCode.PROTOCOL_ERROR, reason: "Send window overflow." })
      return
    }
    stream.sendWindow += frame.delta
    if (stream.status === "open") {
      writer.markWritable(stream)
      if (stream.paused && stream.outboundBytes <= cfg.streamOutboundLowWaterBytes && stream.sendWindow > 0) {
        stream.paused = false
        stream.target?.resume()
      }
    }
  }

  const handleFin = (frame: Extract<StreamWire.Frame, { readonly type: typeof StreamWire.FrameType.FIN }>) => {
    const stream = streams.get(frame.streamID)
    if (!stream || stream.status !== "open" || !stream.target) return
    if (stream.inboundFinReceived) return
    stream.inboundFinReceived = true
    stream.target.end()
    maybeFinishStream(stream)
  }

  const handleReset = (frame: Extract<StreamWire.Frame, { readonly type: typeof StreamWire.FrameType.RESET }>) => {
    const stream = streams.get(frame.streamID)
    if (!stream) return
    cleanupStream(stream)
  }

  const offMessage = socket.onMessage((raw) => {
    if (closed) return
    heartbeat.heard()
    if (typeof raw === "string") {
      protocolFail("Text WebSocket frames are not permitted on browser stream tunnel.")
      return
    }
    let frame: StreamWire.Frame
    try {
      frame = StreamWire.decodeFrame(raw)
    } catch (error) {
      protocolFail(asError(error).message)
      return
    }
    switch (frame.type) {
      case StreamWire.FrameType.OPEN:
        handleOpen(frame)
        return
      case StreamWire.FrameType.DATA:
        handleData(frame)
        return
      case StreamWire.FrameType.WINDOW_UPDATE:
        handleWindowUpdate(frame)
        return
      case StreamWire.FrameType.FIN:
        handleFin(frame)
        return
      case StreamWire.FrameType.RESET:
        handleReset(frame)
        return
      case StreamWire.FrameType.PING:
        writer.enqueueControl({ type: StreamWire.FrameType.PONG, token: frame.token })
        return
      case StreamWire.FrameType.PONG:
        return
      case StreamWire.FrameType.GOAWAY:
        shutdown(1000, frame.reason || "peer goaway", false)
        return
      case StreamWire.FrameType.OPENED:
        protocolFail("Client may not send OPENED frames.")
        return
    }
  })

  const offClose = socket.onClose((code, reason) => {
    shutdown(code, reason, false)
  })

  const offError = socket.onError((error) => {
    shutdown(1006, error.message, true)
  })

  function shutdown(code: number, reason: string, terminate: boolean) {
    if (closed) return
    closed = true
    heartbeat.stop()
    offMessage()
    offClose()
    offError()
    for (const stream of Array.from(streams.values())) {
      cleanupStream(stream)
    }
    writer.close()
    try {
      if (terminate) socket.terminate()
      else if (socket.readyState === WS_OPEN) socket.close(code, reason.slice(0, 120))
    } catch {
      // Socket may already be closing or destroyed.
    }
    closedDeferred.resolve({
      code,
      reason,
      replaced: code === BrowserTunnelHost.CLOSE_ATTACHMENT_REPLACED,
    })
  }

  return {
    closed: closedDeferred.promise,
    activeStreams: () => streams.size,
    bufferedBytes: () => attachmentBytes,
    close(code = BrowserTunnelHost.CLOSE_ATTACHMENT_CLOSED, reason = "attachment closed") {
      if (closed) return
      if (socket.readyState === WS_OPEN) {
        try {
          socket.send(
            StreamWire.encodeFrame({
              type: StreamWire.FrameType.GOAWAY,
              code: StreamWire.ResetCode.ATTACHMENT_CLOSED,
              reason,
            }),
          )
        } catch {
          // Best-effort GOAWAY before closing.
        }
      }
      shutdown(code, reason, false)
    },
  }
}

/**
 * Desktop-side multiplexed stream client bound to one prewarmed binary WebSocket.
 * Returns standard Node `Duplex` sockets per target TCP connection with end-to-end
 * credit backpressure, half-close, RESET cancellation, and zero automatic replay of writes.
 */
export function createClientMux(socket: BrowserTunnelHost.BinarySocket, options: MuxOptions = {}): ClientMux {
  const cfg = resolveConfig({
    streamWindowBytes: StreamWire.DEFAULT_CLIENT_STREAM_WINDOW_BYTES,
    ...options,
  })
  const closedDeferred = Promise.withResolvers<MuxCloseInfo>()
  let closed = false
  let closeReason = "Browser tunnel disconnected."
  let nextStreamID = 1
  let attachmentBytes = 0
  let pendingConnects = 0

  type ClientStream = WritableStream & {
    readonly id: number
    status: "opening" | "open" | "closed"
    readonly opened: ReturnType<typeof Promise.withResolvers<Duplex>>
    duplex?: StreamDuplex
    sendWindow: number
    recvWindow: number
    consumedSinceCredit: number
    readonly inboundChunks: Uint8Array[]
    inboundBytes: number
    inboundFinReceived: boolean
    readonly outboundChunks: Uint8Array[]
    outboundOffset: number
    outboundBytes: number
    outboundFinPending: boolean
    outboundFinSent: boolean
    writeResume?: (error?: Error | null) => void
    finalCallback?: (error?: Error | null) => void
  }

  const streams = new Map<number, ClientStream>()

  const reserveBytes = (bytes: number) => {
    if (bytes <= 0) return true
    if (attachmentBytes + bytes > cfg.maxAttachmentBufferedBytes) return false
    attachmentBytes += bytes
    return true
  }

  const releaseBytes = (bytes: number) => {
    if (bytes <= 0) return
    attachmentBytes = Math.max(0, attachmentBytes - bytes)
  }

  const writer = createFrameWriter(socket, cfg.maxWsBufferedBytes, (error) => {
    shutdown(1006, error.message, true)
  })

  const heartbeat = startHeartbeat(socket, writer, cfg.heartbeatIntervalMs, cfg.heartbeatTimeoutMs, () => {
    shutdown(1001, "Browser tunnel heartbeat timed out.", true)
  })

  const cleanupStream = (
    stream: ClientStream,
    input: {
      readonly error?: Error
      readonly normalClose?: boolean
      readonly sendReset?: StreamWire.ResetCodeValue
      readonly resetReason?: string
    } = {},
  ) => {
    if (stream.status === "closed") return
    const wasOpening = stream.status === "opening"
    stream.status = "closed"
    streams.delete(stream.id)
    if (wasOpening) pendingConnects = Math.max(0, pendingConnects - 1)
    if (stream.outboundBytes > 0) {
      releaseBytes(stream.outboundBytes)
      stream.outboundBytes = 0
    }
    if (stream.inboundBytes > 0) {
      releaseBytes(stream.inboundBytes)
      stream.inboundBytes = 0
    }
    stream.outboundChunks.length = 0
    stream.outboundOffset = 0
    stream.inboundChunks.length = 0

    const writeResume = stream.writeResume
    stream.writeResume = undefined
    const finalCallback = stream.finalCallback
    stream.finalCallback = undefined

    if (input.sendReset !== undefined && !closed) {
      writer.enqueueControl({
        type: StreamWire.FrameType.RESET,
        streamID: stream.id,
        code: input.sendReset,
        reason: input.resetReason ?? "",
      })
    }
    if (wasOpening) {
      stream.opened.reject(input.error ?? new Error("Browser tunnel stream closed while opening."))
    }
    const duplex = stream.duplex
    stream.duplex = undefined

    const streamError = input.error ?? new Error("Browser tunnel stream closed.")
    if (input.normalClose) {
      // Destroy first so Node/Bun never emit an uncaught async 'error' event on idle or unpiped sockets,
      // then settle any outstanding write/FIN callbacks with the cancellation error so discarded bytes
      // are never reported as delivered.
      if (duplex && !duplex.destroyed) duplex.destroy()
      if (writeResume) writeResume(streamError)
      if (finalCallback) finalCallback(streamError)
      return
    }

    if (duplex && !duplex.destroyed) {
      // Settle pending write/final callbacks with the genuine error before destroying, or destroy with error.
      if (writeResume) writeResume(streamError)
      if (finalCallback) finalCallback(streamError)
      if (!duplex.destroyed) {
        if (input.error && duplex.listenerCount("error") > 0) duplex.destroy(input.error)
        else duplex.destroy()
      }
      return
    }
    if (writeResume) writeResume(streamError)
    if (finalCallback) finalCallback(streamError)
  }

  const maybeFinishStream = (stream: ClientStream) => {
    if (stream.status === "open" && stream.inboundFinReceived && stream.inboundBytes === 0 && stream.outboundFinSent) {
      stream.status = "closed"
      streams.delete(stream.id)
    }
  }

  class StreamDuplex extends Duplex {
    readonly connecting = false
    private reading = false
    private idleTimer?: ReturnType<typeof setTimeout>

    constructor(private readonly stream: ClientStream) {
      super({ highWaterMark: cfg.frameChunkBytes * 4, allowHalfOpen: true })
    }

    drainInbound() {
      if (!this.reading || this.destroyed) return
      while (this.stream.inboundChunks.length > 0) {
        const chunk = this.stream.inboundChunks.shift()!
        this.stream.inboundBytes -= chunk.byteLength
        releaseBytes(chunk.byteLength)
        this.stream.consumedSinceCredit += chunk.byteLength
        if (!this.stream.inboundFinReceived && this.stream.consumedSinceCredit >= cfg.creditBatchBytes) {
          const delta = this.stream.consumedSinceCredit
          this.stream.consumedSinceCredit = 0
          this.stream.recvWindow += delta
          writer.enqueueControl({
            type: StreamWire.FrameType.WINDOW_UPDATE,
            streamID: this.stream.id,
            delta,
          })
        }
        const more = this.push(chunk)
        if (!more) {
          this.reading = false
          return
        }
      }
      if (this.stream.inboundFinReceived) {
        this.reading = false
        this.push(null)
        maybeFinishStream(this.stream)
      }
    }

    override _read() {
      this.reading = true
      this.drainInbound()
    }

    override _write(chunk: Buffer | string, encoding: BufferEncoding, callback: (error?: Error | null) => void) {
      if (closed || this.stream.status !== "open") {
        callback(new Error(closeReason))
        return
      }
      const data = typeof chunk === "string" ? Buffer.from(chunk, encoding) : chunk
      if (data.byteLength === 0) {
        callback()
        return
      }
      if (!reserveBytes(data.byteLength)) {
        const error = new Error("Browser tunnel attachment buffer limit exceeded.")
        cleanupStream(this.stream, { error, sendReset: StreamWire.ResetCode.LIMIT_EXCEEDED })
        callback(error)
        return
      }
      const copy = new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice()
      this.stream.outboundChunks.push(copy)
      this.stream.outboundBytes += copy.byteLength
      writer.markWritable(this.stream)
      if (this.stream.outboundBytes >= cfg.streamOutboundHighWaterBytes) {
        this.stream.writeResume = callback
        return
      }
      callback()
    }

    override _final(callback: (error?: Error | null) => void) {
      if (closed || this.stream.status !== "open") {
        callback(new Error(closeReason))
        return
      }
      this.stream.outboundFinPending = true
      this.stream.finalCallback = callback
      writer.markWritable(this.stream)
    }

    override _destroy(error: Error | null, callback: (error?: Error | null) => void) {
      if (this.idleTimer) {
        clearTimeout(this.idleTimer)
        this.idleTimer = undefined
      }
      if (this.stream.status !== "closed") {
        const clean = this.stream.inboundFinReceived && this.stream.inboundBytes === 0 && this.stream.outboundFinSent
        cleanupStream(this.stream, {
          error: error ?? undefined,
          sendReset: clean ? undefined : StreamWire.ResetCode.CANCELLED,
        })
      }
      callback(error)
    }

    setKeepAlive() {
      return this
    }
    setNoDelay() {
      return this
    }
    setTimeout(timeout: number, callback?: () => void) {
      if (this.idleTimer) {
        clearTimeout(this.idleTimer)
        this.idleTimer = undefined
      }
      if (timeout === 0) {
        if (callback) this.off("timeout", callback)
        return this
      }
      if (callback) this.once("timeout", callback)
      this.idleTimer = setTimeout(() => {
        this.idleTimer = undefined
        this.emit("timeout")
      }, timeout)
      this.idleTimer.unref?.()
      return this
    }
    ref() {
      return this
    }
    unref() {
      return this
    }
  }

  const protocolFail = (reason: string) => {
    if (closed) return
    writer.enqueueControl({ type: StreamWire.FrameType.GOAWAY, code: StreamWire.ResetCode.PROTOCOL_ERROR, reason })
    shutdown(1002, reason, true)
  }

  const offMessage = socket.onMessage((raw) => {
    if (closed) return
    heartbeat.heard()
    if (typeof raw === "string") {
      protocolFail("Server sent text frame on binary browser stream tunnel.")
      return
    }
    let frame: StreamWire.Frame
    try {
      frame = StreamWire.decodeFrame(raw)
    } catch (error) {
      protocolFail(asError(error).message)
      return
    }
    switch (frame.type) {
      case StreamWire.FrameType.OPENED: {
        const stream = streams.get(frame.streamID)
        if (!stream || stream.status !== "opening") return
        pendingConnects = Math.max(0, pendingConnects - 1)
        stream.status = "open"
        stream.sendWindow = frame.initialWindow
        const duplex = new StreamDuplex(stream)
        stream.duplex = duplex
        stream.opened.resolve(duplex)
        return
      }
      case StreamWire.FrameType.DATA: {
        const stream = streams.get(frame.streamID)
        if (!stream || stream.status !== "open" || !stream.duplex) return
        if (stream.inboundFinReceived) {
          cleanupStream(stream, {
            error: new Error("Server sent DATA after FIN."),
            sendReset: StreamWire.ResetCode.PROTOCOL_ERROR,
          })
          return
        }
        const len = frame.data.byteLength
        if (len > stream.recvWindow) {
          cleanupStream(stream, {
            error: new Error("Server exceeded stream receive window."),
            sendReset: StreamWire.ResetCode.PROTOCOL_ERROR,
          })
          return
        }
        if (!reserveBytes(len)) {
          cleanupStream(stream, {
            error: new Error("Attachment receive buffer exceeded."),
            sendReset: StreamWire.ResetCode.LIMIT_EXCEEDED,
          })
          return
        }
        stream.recvWindow -= len
        stream.inboundChunks.push(frame.data)
        stream.inboundBytes += len
        stream.duplex.drainInbound()
        return
      }
      case StreamWire.FrameType.WINDOW_UPDATE: {
        const stream = streams.get(frame.streamID)
        if (!stream || stream.status !== "open") return
        if (stream.sendWindow + frame.delta > StreamWire.MAX_STREAM_WINDOW_BYTES) {
          cleanupStream(stream, {
            error: new Error("Server sent overflowing WINDOW_UPDATE."),
            sendReset: StreamWire.ResetCode.PROTOCOL_ERROR,
          })
          return
        }
        stream.sendWindow += frame.delta
        writer.markWritable(stream)
        return
      }
      case StreamWire.FrameType.FIN: {
        const stream = streams.get(frame.streamID)
        if (!stream || stream.status !== "open" || !stream.duplex) return
        stream.inboundFinReceived = true
        stream.duplex.drainInbound()
        return
      }
      case StreamWire.FrameType.RESET: {
        const stream = streams.get(frame.streamID)
        if (!stream) return
        const message = frame.reason || resetCodeMessage(frame.code)
        cleanupStream(stream, { error: new Error(message) })
        return
      }
      case StreamWire.FrameType.PING:
        writer.enqueueControl({ type: StreamWire.FrameType.PONG, token: frame.token })
        return
      case StreamWire.FrameType.PONG:
        return
      case StreamWire.FrameType.GOAWAY: {
        const code =
          frame.reason === "replaced"
            ? BrowserTunnelHost.CLOSE_ATTACHMENT_REPLACED
            : BrowserTunnelHost.CLOSE_ATTACHMENT_CLOSED
        shutdown(code, frame.reason || "Browser tunnel closed by server.", false)
        return
      }
      case StreamWire.FrameType.OPEN:
        protocolFail("Server may not send OPEN frames.")
        return
    }
  })

  const offClose = socket.onClose((code, reason) => {
    shutdown(code, reason || "Browser tunnel closed.", false)
  })

  const offError = socket.onError((error) => {
    shutdown(1006, error.message || "Browser tunnel socket error.", true)
  })

  function shutdown(code: number, reason: string, terminate: boolean, normalClose = false) {
    if (closed) return
    closed = true
    closeReason = reason || "Browser tunnel disconnected."
    heartbeat.stop()
    offMessage()
    offClose()
    offError()
    const err = new Error(closeReason)
    for (const stream of Array.from(streams.values())) {
      cleanupStream(stream, { error: err, normalClose })
    }
    writer.close()
    try {
      if (terminate) socket.terminate()
      else if (socket.readyState === WS_OPEN) socket.close(code, reason.slice(0, 120))
    } catch {
      // Socket may already be closed.
    }
    closedDeferred.resolve({
      code,
      reason: closeReason,
      replaced: code === BrowserTunnelHost.CLOSE_ATTACHMENT_REPLACED || reason === "replaced",
    })
  }

  return {
    closed: closedDeferred.promise,
    activeStreams: () => streams.size,
    bufferedBytes: () => attachmentBytes,
    isClosed: () => closed,
    ping() {
      if (closed) return
      writer.enqueueControl({ type: StreamWire.FrameType.PING, token: randomBytes(8) })
    },
    async openStream(target: Browser.TunnelTarget, signal?: AbortSignal): Promise<Duplex> {
      if (closed) throw new Error(closeReason)
      if (signal?.aborted) throw new Error("Browser tunnel open was cancelled.")
      if (streams.size >= cfg.maxStreams || pendingConnects >= cfg.maxPendingConnects) {
        throw new Error(`Browser attachment has reached its ${cfg.maxStreams}-stream limit.`)
      }
      const id = nextStreamID
      nextStreamID = nextStreamID >= 0xfffffffe ? 1 : nextStreamID + 1
      if (streams.has(id)) throw new Error("Browser stream ID space exhausted.")

      const opened = Promise.withResolvers<Duplex>()
      pendingConnects += 1

      const stream: ClientStream = {
        id,
        status: "opening",
        opened,
        sendWindow: 0,
        recvWindow: cfg.streamWindowBytes,
        consumedSinceCredit: 0,
        inboundChunks: [],
        inboundBytes: 0,
        inboundFinReceived: false,
        outboundChunks: [],
        outboundOffset: 0,
        outboundBytes: 0,
        outboundFinPending: false,
        outboundFinSent: false,
        inRoundRobin: false,
        hasWritableOutput() {
          if (stream.status !== "open") return false
          if (stream.outboundBytes > 0 && stream.sendWindow > 0) return true
          return stream.outboundBytes === 0 && stream.outboundFinPending && !stream.outboundFinSent
        },
        nextOutboundFrame() {
          if (stream.status !== "open") return undefined
          if (stream.outboundBytes > 0 && stream.sendWindow > 0) {
            const maxTake = Math.min(cfg.frameChunkBytes, stream.sendWindow)
            const slice = takeChunk(stream.outboundChunks, stream.outboundOffset, maxTake)
            stream.outboundOffset = slice.nextOffset
            stream.outboundBytes -= slice.bytes.byteLength
            stream.sendWindow -= slice.bytes.byteLength
            releaseBytes(slice.bytes.byteLength)
            if (stream.writeResume && stream.outboundBytes <= cfg.streamOutboundLowWaterBytes) {
              const resume = stream.writeResume
              stream.writeResume = undefined
              resume()
            }
            return StreamWire.encodeFrame({
              type: StreamWire.FrameType.DATA,
              streamID: stream.id,
              data: slice.bytes,
            })
          }
          if (stream.outboundBytes === 0 && stream.outboundFinPending && !stream.outboundFinSent) {
            stream.outboundFinSent = true
            const cb = stream.finalCallback
            stream.finalCallback = undefined
            const encoded = StreamWire.encodeFrame({ type: StreamWire.FrameType.FIN, streamID: stream.id })
            if (cb) cb()
            maybeFinishStream(stream)
            return encoded
          }
          return undefined
        },
      }
      streams.set(id, stream)

      const onAbort = () => {
        if (stream.status !== "opening") return
        cleanupStream(stream, {
          error: new Error("Browser tunnel open was cancelled."),
          sendReset: StreamWire.ResetCode.CANCELLED,
        })
      }
      signal?.addEventListener("abort", onAbort, { once: true })

      writer.enqueueControl({
        type: StreamWire.FrameType.OPEN,
        streamID: id,
        host: target.host,
        port: target.port,
        initialWindow: cfg.streamWindowBytes,
      })

      try {
        return await opened.promise
      } finally {
        signal?.removeEventListener("abort", onAbort)
      }
    },
    close(code = 1000, reason = "client closed") {
      if (closed) return
      if (socket.readyState === WS_OPEN) {
        try {
          socket.send(
            StreamWire.encodeFrame({
              type: StreamWire.FrameType.GOAWAY,
              code: StreamWire.ResetCode.CANCELLED,
              reason,
            }),
          )
        } catch {
          // Best-effort GOAWAY.
        }
      }
      shutdown(code, reason, false, true)
    },
  }
}

function takeChunk(chunks: Uint8Array[], offset: number, maxBytes: number) {
  const head = chunks[0]
  const available = head.byteLength - offset
  if (available <= maxBytes) {
    chunks.shift()
    return {
      bytes: offset === 0 ? head : head.subarray(offset),
      nextOffset: 0,
    }
  }
  return {
    bytes: head.subarray(offset, offset + maxBytes),
    nextOffset: offset + maxBytes,
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function asError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error))
}

function resetCodeMessage(code: StreamWire.ResetCodeValue) {
  switch (code) {
    case StreamWire.ResetCode.CANCELLED:
      return "Browser tunnel stream was cancelled."
    case StreamWire.ResetCode.CONNECT_FAILED:
      return "Browser tunnel could not connect to the target."
    case StreamWire.ResetCode.POLICY_DENIED:
      return "Target address is blocked by browser egress policy."
    case StreamWire.ResetCode.LIMIT_EXCEEDED:
      return "Browser tunnel resource limit exceeded."
    case StreamWire.ResetCode.PROTOCOL_ERROR:
      return "Browser tunnel protocol error."
    case StreamWire.ResetCode.ATTACHMENT_CLOSED:
      return "Browser attachment was closed."
    case StreamWire.ResetCode.INTERNAL_ERROR:
      return "Browser tunnel target socket error."
  }
}
