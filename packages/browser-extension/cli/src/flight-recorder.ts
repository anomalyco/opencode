import fs from "node:fs/promises"
import path from "node:path"
import { performance } from "node:perf_hooks"
import type { JsonObject } from "./protocol.ts"
import { getNumber, getObject, getString } from "./relay-helpers.ts"
import type { FlightRecorderSaveResponse, FlightRecorderStatusResponse } from "./relay-schema.ts"
import {
  cdpArtifactType,
  findByRecordingTarget,
  prepareCdpScreencastViewport,
  startFfmpegVideoEncoder,
  type RecordingTargetOptions,
  type SendDebuggerCommand,
  type StartVideoEncoder,
} from "./recording-relay.ts"

const defaultRetentionMs = 60_000
const defaultFrameRate = 60
const maxRetentionMs = 120_000
const maxBufferedBytes = 128 * 1024 * 1024
const maxBufferedFrames = 7_200

type BufferedFrame = {
  readonly data: Buffer
  readonly receivedAt: number
  readonly surfaceWidth?: number
}

type ActiveFlightRecorder = {
  readonly tabId: number
  readonly sessionId?: string
  readonly retentionMs: number
  readonly frameRate: number
  readonly startedAt: number
  readonly width: number
  readonly height: number
  readonly frames: BufferedFrame[]
  bufferedBytes: number
  sourceFrameCount: number
  droppedFrameCount: number
  savePromise?: Promise<FlightRecorderSaveReceipt>
}

export type FlightRecorderTarget = RecordingTargetOptions

export type FlightRecorderStartOptions = {
  readonly tabId: number
  readonly sessionId?: string
  readonly retentionMs?: number
  readonly frameRate?: number
}

export type FlightRecorderStatus = FlightRecorderStatusResponse

export type FlightRecorderSaveReceipt = FlightRecorderSaveResponse

export class FlightRecorderRelay {
  private readonly active = new Map<number, ActiveFlightRecorder>()
  private readonly starting = new Set<number>()

  constructor(readonly options: {
    readonly sendDebuggerCommand: SendDebuggerCommand
    readonly isExtensionConnected: () => boolean
    readonly isTabRecording?: (tabId: number) => boolean
    readonly startVideoEncoder?: StartVideoEncoder
    readonly now?: () => number
    readonly monotonicNow?: () => number
  }) {}

  hasActiveRecorders(): boolean {
    return this.active.size > 0 || this.starting.size > 0
  }

  isActiveTab(tabId: number): boolean {
    return this.active.has(tabId) || this.starting.has(tabId)
  }

  async start(options: FlightRecorderStartOptions): Promise<FlightRecorderStatus> {
    if (!this.options.isExtensionConnected()) throw new Error("OpenCode Browser extension is not connected")
    if (this.isActiveTab(options.tabId)) throw new Error("Flight recorder already active for this tab")
    if (this.options.isTabRecording?.(options.tabId)) throw new Error("Stop the active recording before starting the flight recorder")
    const retentionMs = options.retentionMs ?? defaultRetentionMs
    if (!Number.isInteger(retentionMs) || retentionMs < 1_000 || retentionMs > maxRetentionMs) {
      throw new Error("Flight recorder retentionMs must be an integer from 1000 to 120000")
    }
    const frameRate = options.frameRate ?? defaultFrameRate
    if (!Number.isInteger(frameRate) || frameRate < 1 || frameRate > 60) {
      throw new Error("Flight recorder frameRate must be an integer from 1 to 60")
    }
    this.starting.add(options.tabId)
    try {
      const { width, height } = await prepareCdpScreencastViewport(this.options.sendDebuggerCommand, options.tabId)
      const recorder: ActiveFlightRecorder = {
        tabId: options.tabId,
        ...(options.sessionId ? { sessionId: options.sessionId } : {}),
        retentionMs,
        frameRate,
        startedAt: this.now(),
        width,
        height,
        frames: [],
        bufferedBytes: 0,
        sourceFrameCount: 0,
        droppedFrameCount: 0,
      }
      this.active.set(options.tabId, recorder)
      await this.options.sendDebuggerCommand({
        tabId: options.tabId,
        method: "Page.startScreencast",
        params: { format: "jpeg", quality: 90, everyNthFrame: 1 },
      })
      return this.statusFor(recorder)
    } catch (error) {
      this.active.delete(options.tabId)
      throw error
    } finally {
      this.starting.delete(options.tabId)
    }
  }

  status(target: FlightRecorderTarget): FlightRecorderStatus {
    const recorder = this.find(target)
    return recorder ? this.statusFor(recorder) : { active: false }
  }

  async saveLast(target: FlightRecorderTarget & { readonly outputPath: string; readonly durationMs?: number }): Promise<FlightRecorderSaveReceipt> {
    const recorder = this.find(target)
    if (!recorder) throw new Error("No active flight recorder found")
    if (recorder.savePromise) throw new Error("Flight recorder save already in progress")
    const savePromise = this.saveLastForRecorder(recorder, target)
    recorder.savePromise = savePromise
    try {
      return await savePromise
    } finally {
      if (recorder.savePromise === savePromise) delete recorder.savePromise
    }
  }

  private async saveLastForRecorder(
    recorder: ActiveFlightRecorder,
    target: FlightRecorderTarget & { readonly outputPath: string; readonly durationMs?: number },
  ): Promise<FlightRecorderSaveReceipt> {
    const artifactType = cdpArtifactType(target.outputPath)
    if (!artifactType) throw new Error("Flight recorder output path must end in .webm or .mp4")
    const requestedDuration = target.durationMs ?? Math.min(30_000, recorder.retentionMs)
    if (!Number.isInteger(requestedDuration) || requestedDuration < 1 || requestedDuration > recorder.retentionMs) {
      throw new Error(`Flight recorder durationMs must be an integer from 1 to ${recorder.retentionMs}`)
    }
    if (recorder.frames.length === 0) throw new Error("Flight recorder has not captured any frames yet")
    await assertOutputAvailable(target.outputPath)
    await assertOutputAvailable(`${target.outputPath}.json`)
    const newestAt = recorder.frames.at(-1)!.receivedAt
    const frames = recorder.frames.filter((frame) => frame.receivedAt >= newestAt - requestedDuration)
    const startAt = frames[0]!.receivedAt
    const endAt = frames.at(-1)!.receivedAt
    const durationMs = Math.max(1, endAt - startAt)
    await fs.mkdir(path.dirname(target.outputPath), { recursive: true })
    let encoder: Awaited<ReturnType<StartVideoEncoder>> | undefined
    try {
      encoder = await (this.options.startVideoEncoder ?? startFfmpegVideoEncoder)({
        outputPath: target.outputPath,
        artifactType,
        frameRate: recorder.frameRate,
        width: recorder.width,
        height: recorder.height,
      })
      for (const [index, frame] of frames.entries()) {
        const next = frames[index + 1]
        const timestampMs = frame.receivedAt - startAt
        const frameDurationMs = Math.max(1, (next?.receivedAt ?? endAt + Math.round(1_000 / recorder.frameRate)) - frame.receivedAt)
        await encoder.write(frame.data, timestampMs, frameDurationMs, frame.surfaceWidth)
      }
      await encoder.finish()
      const receipt = {
        path: target.outputPath,
        durationMs,
        frameCount: frames.length,
        sourceFrameCount: recorder.sourceFrameCount,
        droppedFrameCount: recorder.droppedFrameCount,
      }
      await fs.writeFile(`${target.outputPath}.json`, `${JSON.stringify({ ...receipt, savedAt: new Date(this.now()).toISOString(), retainedDurationMs: this.retainedDuration(recorder) }, null, 2)}\n`, "utf8")
      return receipt
    } catch (error) {
      await encoder?.cancel().catch(() => {})
      throw error
    }
  }

  async cancel(target: FlightRecorderTarget): Promise<{ readonly cancelled: boolean }> {
    const recorder = this.find(target)
    if (!recorder) return { cancelled: false }
    await recorder.savePromise?.catch(() => {})
    this.active.delete(recorder.tabId)
    await this.options.sendDebuggerCommand({ tabId: recorder.tabId, method: "Page.stopScreencast", params: {} }).catch(() => {})
    return { cancelled: true }
  }

  async cleanupAll(): Promise<void> {
    await Promise.all([...this.active.values()].map((recorder) => this.cancel({ tabId: recorder.tabId })))
  }

  handleDebuggerEvent(options: { readonly tabId: number; readonly method: string; readonly params: JsonObject | undefined }): boolean {
    if (options.method !== "Page.screencastFrame") return false
    const recorder = this.active.get(options.tabId)
    if (!recorder) return false
    const frameSessionId = getNumber(options.params, "sessionId")
    if (frameSessionId !== undefined) {
      void this.options.sendDebuggerCommand({
        tabId: recorder.tabId,
        method: "Page.screencastFrameAck",
        params: { sessionId: frameSessionId },
      }).catch(() => {})
    }
    const frameData = getString(options.params, "data")
    if (frameData === undefined) return true
    recorder.sourceFrameCount += 1
    if (frameData.length > Math.ceil(maxBufferedBytes * 4 / 3) + 4) {
      recorder.droppedFrameCount += 1
      return true
    }
    const data = Buffer.from(frameData, "base64")
    if (data.byteLength > maxBufferedBytes) {
      recorder.droppedFrameCount += 1
      return true
    }
    const surfaceWidth = getNumber(getObject(options.params?.metadata), "deviceWidth")
    const frame: BufferedFrame = {
      data,
      receivedAt: this.monotonicNow(),
      ...(surfaceWidth !== undefined ? { surfaceWidth } : {}),
    }
    recorder.frames.push(frame)
    recorder.bufferedBytes += data.byteLength
    this.trim(recorder, frame.receivedAt)
    return true
  }

  private trim(recorder: ActiveFlightRecorder, now: number): void {
    while (recorder.frames.length > 0 && (
      now - recorder.frames[0]!.receivedAt > recorder.retentionMs ||
      recorder.frames.length > maxBufferedFrames ||
      recorder.bufferedBytes > maxBufferedBytes
    )) {
      const removed = recorder.frames.shift()!
      recorder.bufferedBytes -= removed.data.byteLength
      recorder.droppedFrameCount += 1
    }
  }

  private retainedDuration(recorder: ActiveFlightRecorder): number {
    if (recorder.frames.length < 2) return 0
    return Math.max(0, recorder.frames.at(-1)!.receivedAt - recorder.frames[0]!.receivedAt)
  }

  private statusFor(recorder: ActiveFlightRecorder): FlightRecorderStatus {
    return {
      active: true,
      tabId: recorder.tabId,
      ...(recorder.sessionId ? { sessionId: recorder.sessionId } : {}),
      startedAt: recorder.startedAt,
      retentionMs: recorder.retentionMs,
      retainedDurationMs: this.retainedDuration(recorder),
      frameRate: recorder.frameRate,
      bufferedFrames: recorder.frames.length,
      bufferedBytes: recorder.bufferedBytes,
      sourceFrameCount: recorder.sourceFrameCount,
      droppedFrameCount: recorder.droppedFrameCount,
      saving: recorder.savePromise !== undefined,
    }
  }

  private find(target: FlightRecorderTarget): ActiveFlightRecorder | undefined {
    return findByRecordingTarget(this.active, target, "Multiple flight recorders are active; provide sessionId or tabId")
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }

  private monotonicNow(): number {
    return this.options.monotonicNow?.() ?? performance.now()
  }
}

async function assertOutputAvailable(filePath: string): Promise<void> {
  try {
    await fs.stat(filePath)
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return
    throw error
  }
  throw new Error(`Flight recorder output already exists: ${filePath}`)
}
