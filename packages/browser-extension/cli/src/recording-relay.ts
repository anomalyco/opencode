import { execFile, spawn } from "node:child_process"
import crypto from "node:crypto"
import { once } from "node:events"
import fs from "node:fs/promises"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { Option, Predicate, Schema } from "effect"
import { terminateChildProcess } from "./child-process.ts"
import { mjpegMatroskaFrame, mjpegMatroskaHeader } from "./mjpeg-matroska.ts"
import type { ExtensionCommand, JsonObject } from "./protocol.ts"
import { getNumber, getObject, getString } from "./relay-helpers.ts"
import type { ConnectedTarget } from "./relay-types.ts"
import { decodeRecordingFrame } from "./recording-protocol.ts"
import type { RecordingCancelResponse, RecordingQuality, RecordingStatusResponse, RecordingTargetRequest } from "./relay-schema.ts"

const defaultMaxDurationMs = 15 * 60 * 1_000
const defaultCdpFrameRate = 60
const maxRecordingFrameRate = 60
const maxPendingCdpFrames = 30
const fallbackCdpWidth = 1_280
const fallbackCdpHeight = 720
const cdpJpegQuality = 100
const maxPendingTabCaptureBytes = 16 * 1024 * 1024
const maxTabCaptureOutputBytes = 1024 * 1024 * 1024

type RecordingMode = "auto" | "tab-capture" | "cdp"
type ActiveRecordingMode = "tab-capture" | "cdp"
type RecordingArtifactType = "webm" | "mp4"

export type SendDebuggerCommand = (options: {
  readonly tabId: number
  readonly sessionId?: string
  readonly method: string
  readonly params: JsonObject
}) => Promise<JsonObject>

export type RecordingStartOptions = {
  readonly tabId: number
  readonly sessionId?: string
  readonly owner: ConnectedTarget["owner"]
  readonly outputPath: string
  readonly mode?: RecordingMode
  readonly frameRate?: number
  readonly audio?: boolean
  readonly videoBitsPerSecond?: number
  readonly audioBitsPerSecond?: number
  readonly maxDurationMs?: number
}

export type RecordingTargetOptions = RecordingTargetRequest

export type RecordingStartResult =
  | {
    readonly success: true
    readonly tabId: number
    readonly startedAt: number
    readonly path: string
    readonly mimeType: string
    readonly mode: ActiveRecordingMode
    readonly artifactType: RecordingArtifactType
    readonly frameRate?: number
  }
  | {
    readonly success: false
    readonly error: string
  }

export type RecordingStopResult =
  | {
    readonly success: true
    readonly tabId: number
    readonly duration: number
    readonly path: string
    readonly size: number
    readonly mode: ActiveRecordingMode
    readonly artifactType: RecordingArtifactType
    readonly frameCount?: number
    readonly quality?: RecordingQuality
  }
  | {
    readonly success: false
    readonly error: string
  }

export type RecordingStatusResult = RecordingStatusResponse

export type RecordingCancelResult = RecordingCancelResponse

type ActiveRecordingBase = {
  tabId: number
  sessionId?: string
  outputPath: string
  startedAt: number
  mode: ActiveRecordingMode
  artifactType: RecordingArtifactType
  maxDurationTimer?: ReturnType<typeof setTimeout>
  resolveStop?: (result: RecordingStopResult) => void
  cleanupPromise?: Promise<void>
}

type TabCaptureRecording = ActiveRecordingBase & {
  mode: "tab-capture"
  artifactType: "webm"
  temporaryPath: string
  file: Awaited<ReturnType<typeof fs.open>>
  expectedSequence: number
  receivedBytes: number
  pendingWriteBytes: number
  writePromise: Promise<void>
  writeError?: Error
  stopping: boolean
  finalized: boolean
  stopPromise?: Promise<RecordingStopResult>
  finalizePromise?: Promise<void>
}

type CdpRecording = ActiveRecordingBase & {
  mode: "cdp"
  artifactType: "webm" | "mp4"
  frameRate: number
  encoder: VideoEncoder
  lastFrame?: CdpVideoFrame
  frameCount: number
  sourceFrameCount: number
  encodedSourceFrameCount: number
  coalescedFrameCount: number
  droppedFrameCount: number
  pendingFrameCount: number
  width: number
  height: number
  sourceWidth?: number
  sourceHeight?: number
  stopped: boolean
  stopping: boolean
  startedMonotonicAt: number
  stopPromise?: Promise<RecordingStopResult>
  writePromise: Promise<void>
  writeError?: Error
}

type CdpVideoFrame = {
  readonly buffer: Buffer
  readonly frameNumber: number
  readonly surfaceWidth?: number
}

export type VideoEncoder = {
  readonly write: (frame: Buffer, timestampMs: number, durationMs: number, surfaceWidth?: number) => Promise<void>
  readonly finish: () => Promise<void>
  readonly cancel: () => Promise<void>
}

export type StartVideoEncoder = (options: {
  readonly outputPath: string
  readonly artifactType: "webm" | "mp4"
  readonly frameRate: number
  readonly width: number
  readonly height: number
}) => Promise<VideoEncoder>

type ActiveRecording = TabCaptureRecording | CdpRecording

type StartingRecording = {
  readonly tabId: number
  readonly sessionId?: string
  cancelled: boolean
  promise?: Promise<RecordingStartResult>
}

type ExtensionStartResult =
  | {
    readonly success: true
    readonly tabId: number
    readonly startedAt: number
    readonly mimeType?: string
  }
  | {
    readonly success: false
    readonly error: string
  }

type ExtensionStopResult =
  | {
    readonly success: true
    readonly tabId: number
    readonly duration: number
  }
  | {
    readonly success: false
    readonly error: string
  }

type ExtensionStatusResult = {
  readonly isRecording: boolean
  readonly tabId?: number
  readonly startedAt?: number
}

export class RecordingRelay {
  private readonly activeRecordings = new Map<number, ActiveRecording>()
  private readonly startingRecordings = new Map<number, StartingRecording>()

  constructor(readonly options: {
    readonly sendToExtension: (command: Omit<ExtensionCommand, "id">) => Promise<JsonObject>
    readonly sendDebuggerCommand: SendDebuggerCommand
    readonly isExtensionConnected: () => boolean
    readonly isTabUnavailable?: (tabId: number) => boolean
    readonly startVideoEncoder?: StartVideoEncoder
    readonly now?: () => number
    readonly monotonicNow?: () => number
  }) {}

  hasActiveRecordings(): boolean {
    return this.activeRecordings.size > 0 || this.startingRecordings.size > 0
  }

  isRecordingTab(tabId: number): boolean {
    return this.activeRecordings.has(tabId) || this.startingRecordings.has(tabId)
  }

  async startRecording(options: RecordingStartOptions): Promise<RecordingStartResult> {
    if (options.frameRate !== undefined && (!Number.isInteger(options.frameRate) || options.frameRate < 1 || options.frameRate > maxRecordingFrameRate)) {
      return { success: false, error: "Recording frameRate must be an integer from 1 to 60" }
    }
    if (!this.options.isExtensionConnected()) {
      return { success: false, error: "OpenCode Browser extension is not connected" }
    }
    if (this.activeRecordings.has(options.tabId) || this.startingRecordings.has(options.tabId)) {
      return { success: false, error: "Recording already in progress for this tab" }
    }
    if (this.options.isTabUnavailable?.(options.tabId)) {
      return { success: false, error: "Stop the active flight recorder before starting a recording" }
    }
    const starting: StartingRecording = {
      tabId: options.tabId,
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
      cancelled: false,
    }
    this.startingRecordings.set(options.tabId, starting)
    const promise = this.startReservedRecording(options, starting)
    starting.promise = promise
    try {
      return await promise
    } finally {
      if (this.startingRecordings.get(options.tabId) === starting) {
        this.startingRecordings.delete(options.tabId)
      }
    }
  }

  async stopRecording(options: RecordingTargetOptions): Promise<RecordingStopResult> {
    if (!this.options.isExtensionConnected()) {
      return { success: false, error: "OpenCode Browser extension is not connected" }
    }
    const recording = this.findRecording(options)
    if (!recording) {
      return { success: false, error: "No active recording found" }
    }
    if (recording.stopPromise) return recording.stopPromise
    if (recording.cleanupPromise) {
      await recording.cleanupPromise
      return { success: false, error: "Recording was cancelled" }
    }
    if (recording.mode === "cdp") {
      return this.stopCdpRecording(recording)
    }
    const stopPromise = this.stopTabCaptureRecording(recording)
    recording.stopPromise = stopPromise
    return stopPromise
  }

  private async stopTabCaptureRecording(recording: TabCaptureRecording): Promise<RecordingStopResult> {
    let stopTimeout: ReturnType<typeof setTimeout> | undefined
    const finalResult = new Promise<RecordingStopResult>((resolve) => {
      stopTimeout = setTimeout(() => {
        delete recording.resolveStop
        if (this.activeRecordings.get(recording.tabId) === recording && !recording.cleanupPromise && !recording.finalizePromise) {
          const cancel = this.options.isExtensionConnected()
            ? this.options.sendToExtension({ method: "recording.cancel", params: { tabId: recording.tabId } })
            : undefined
          void this.cleanupTabCaptureRecording(recording, cancel)
        }
        resolve({ success: false, error: "Timeout waiting for recording data" })
      }, 30_000)
      recording.resolveStop = (result) => {
        if (stopTimeout) clearTimeout(stopTimeout)
        resolve(result)
      }
    })

    try {
      const result = parseExtensionStopResult(await this.options.sendToExtension({
        method: "recording.stop",
        params: { tabId: recording.tabId },
      }))
      if (!result.success) {
        if (stopTimeout) clearTimeout(stopTimeout)
        delete recording.resolveStop
        await this.failTabCaptureRecording(recording, result.error)
        return result
      }
      return await finalResult
    } catch (error) {
      if (stopTimeout) clearTimeout(stopTimeout)
      delete recording.resolveStop
      const message = error instanceof Error ? error.message : String(error)
      await this.failTabCaptureRecording(recording, message)
      return { success: false, error: message }
    }
  }

  async statusRecording(options: RecordingTargetOptions): Promise<RecordingStatusResult> {
    const recording = this.findRecording(options)
    if (!recording || !this.options.isExtensionConnected()) {
      return { isRecording: false }
    }
    if (recording.mode === "cdp") {
      return {
        isRecording: true,
        tabId: recording.tabId,
        startedAt: recording.startedAt,
        path: recording.outputPath,
        mode: "cdp",
        artifactType: recording.artifactType,
        quality: recordingQuality(recording, this.monotonicNow() - recording.startedMonotonicAt),
        frameCount: recording.stopping
          ? recording.frameCount
          : Math.max(0, Math.round(((this.monotonicNow() - recording.startedMonotonicAt) / 1_000) * recording.frameRate)),
      }
    }
    let result: ExtensionStatusResult | undefined
    try {
      result = parseExtensionStatusResult(await this.options.sendToExtension({
        method: "recording.status",
        params: { tabId: recording.tabId },
      }))
    } catch {
      // A transient status poll failure must not destroy an in-progress
      // recording; report last-known local state instead.
    }
    return {
      isRecording: result?.isRecording ?? true,
      tabId: recording.tabId,
      startedAt: result?.startedAt ?? recording.startedAt,
      path: recording.outputPath,
      size: recording.receivedBytes,
      mode: "tab-capture",
      artifactType: "webm",
    }
  }

  async cancelRecording(options: RecordingTargetOptions): Promise<RecordingCancelResult> {
    const starting = this.findStartingRecording(options)
    if (starting) {
      starting.cancelled = true
      await starting.promise?.catch(() => {})
      return { success: true }
    }
    const recording = this.findRecording(options)
    if (!recording) {
      return { success: true }
    }
    if (recording.cleanupPromise) {
      await recording.cleanupPromise
      return { success: true }
    }
    if (recording.mode === "cdp") {
      await this.cancelCdpRecording(recording)
      return { success: true }
    }
    if (recording.finalizePromise) {
      await recording.finalizePromise
      return { success: true }
    }
    if (!this.options.isExtensionConnected()) {
      recording.resolveStop?.({ success: false, error: "Recording was cancelled" })
      await this.cleanupRecording(recording.tabId)
      return { success: false, error: "OpenCode Browser extension is not connected" }
    }
    const result = this.options.sendToExtension({ method: "recording.cancel", params: { tabId: recording.tabId } }).then(
      parseCancelResult,
      (error: unknown) => ({ success: false, error: error instanceof Error ? error.message : String(error) }),
    ).then((result) => {
      recording.resolveStop?.({ success: false, error: "Recording was cancelled" })
      return result
    })
    await this.cleanupTabCaptureRecording(recording, result)
    return result
  }

  async cleanupAll(reason: string): Promise<void> {
    const starting = Array.from(this.startingRecordings.values())
    const startingTabIds = new Set(starting.map((recording) => recording.tabId))
    const active = Array.from(this.activeRecordings.values()).filter((recording) => {
      return !startingTabIds.has(recording.tabId)
    })
    for (const recording of starting) recording.cancelled = true
    await Promise.all(starting.map(async (recording) => {
      await recording.promise?.catch(() => {})
    }))
    await Promise.all(active.map(async (recording) => {
      await this.abortActiveRecording(recording, reason)
    }))
  }

  async abortRecordingForTab(options: { readonly tabId: number; readonly reason: string }): Promise<void> {
    const starting = this.startingRecordings.get(options.tabId)
    if (starting) {
      starting.cancelled = true
      await starting.promise?.catch(() => {})
      return
    }
    const recording = this.activeRecordings.get(options.tabId)
    if (!recording) {
      return
    }
    await this.abortActiveRecording(recording, options.reason)
  }

  private async abortActiveRecording(recording: ActiveRecording, reason: string): Promise<void> {
    if (recording.mode === "tab-capture" && recording.finalizePromise) {
      await recording.finalizePromise
      return
    }
    recording.resolveStop?.({ success: false, error: reason })
    if (recording.mode === "cdp") {
      await this.cancelCdpRecording(recording)
      return
    }
    await this.cleanupTabCaptureRecording(recording)
  }

  handleRecordingCancelled(message: JsonObject): void {
    const params = getObject(message.params)
    const tabId = getNumber(params, "tabId")
    const recording = tabId === undefined ? undefined : this.activeRecordings.get(tabId)
    if (!recording) {
      return
    }
    void this.abortActiveRecording(recording, "Recording was cancelled")
  }

  handleDebuggerEvent(options: { readonly tabId: number; readonly method: string; readonly params: JsonObject | undefined }): boolean {
    if (options.method !== "Page.screencastFrame") {
      return false
    }
    const recording = this.activeRecordings.get(options.tabId)
    if (!recording || recording.mode !== "cdp") {
      return false
    }
    const frameSessionId = getNumber(options.params, "sessionId")
    if (frameSessionId !== undefined) {
      void this.options.sendDebuggerCommand({
        tabId: recording.tabId,
        method: "Page.screencastFrameAck",
        params: { sessionId: frameSessionId },
      }).catch((error: unknown) => {
        if (!recording.stopped && !recording.stopping) console.error("CDP recording frame acknowledgement failed", error)
      })
    }
    const frameData = getString(options.params, "data")
    if (recording.stopped || recording.stopping || frameData === undefined) {
      return true
    }
    const metadata = getObject(options.params?.metadata)
    recording.sourceFrameCount += 1
    if (recording.pendingFrameCount >= maxPendingCdpFrames || recording.writeError) {
      recording.droppedFrameCount += 1
      return true
    }
    const deviceWidth = getNumber(metadata, "deviceWidth")
    const deviceHeight = getNumber(metadata, "deviceHeight")
    if (deviceWidth !== undefined) recording.sourceWidth = deviceWidth
    if (deviceHeight !== undefined) recording.sourceHeight = deviceHeight
    const buffer = Buffer.from(frameData, "base64")
    const receivedAt = this.monotonicNow()
    const rawFramePosition = ((receivedAt - recording.startedMonotonicAt) / 1_000) * recording.frameRate
    let frameNumber = recording.sourceFrameCount === 1
      ? 0
      : Math.max(0, Math.floor(rawFramePosition))
    if (recording.lastFrame && frameNumber === recording.lastFrame.frameNumber && rawFramePosition - frameNumber >= 0.5) {
      frameNumber = recording.lastFrame.frameNumber + 1
    }
    recording.pendingFrameCount += 1
    recording.writePromise = recording.writePromise.then(async () => {
      if (recording.lastFrame && frameNumber !== recording.lastFrame.frameNumber) {
        await this.writeSourceFrame(recording, recording.lastFrame, frameNumber)
      } else if (recording.lastFrame) {
        recording.coalescedFrameCount += 1
      }
      recording.lastFrame = {
        buffer,
        frameNumber,
        ...(deviceWidth !== undefined ? { surfaceWidth: deviceWidth } : {}),
      }
    }).catch((error: unknown) => {
      recording.writeError = error instanceof Error ? error : new Error(String(error))
    }).finally(() => {
      recording.pendingFrameCount -= 1
    })
    return true
  }

  handleBinaryData(data: Buffer): void {
    const frame = decodeRecordingFrame(data)
    const recording = this.activeRecordings.get(frame.tabId)
    if (!recording || recording.mode !== "tab-capture") {
      return
    }
    if (recording.stopping || recording.finalized) return
    if (recording.writeError) {
      void this.failTabCaptureRecording(recording, recording.writeError.message)
      return
    }
    if (frame.sequence !== recording.expectedSequence) {
      void this.failTabCaptureRecording(recording, `Recording frame sequence ${frame.sequence} did not match expected ${recording.expectedSequence}`)
      return
    }
    recording.expectedSequence += 1
    if (frame.final) {
      recording.stopping = true
      if (recording.maxDurationTimer) clearTimeout(recording.maxDurationTimer)
      recording.finalizePromise = this.finishTabCaptureRecording(recording)
      void recording.finalizePromise
      return
    }
    if (recording.receivedBytes + frame.payload.byteLength > maxTabCaptureOutputBytes) {
      void this.failTabCaptureRecording(recording, `Tab capture exceeds ${maxTabCaptureOutputBytes} bytes`)
      return
    }
    if (recording.pendingWriteBytes + frame.payload.byteLength > maxPendingTabCaptureBytes) {
      void this.failTabCaptureRecording(recording, `Tab capture pending writes exceed ${maxPendingTabCaptureBytes} bytes`)
      return
    }
    const payload = frame.payload
    recording.receivedBytes += payload.byteLength
    recording.pendingWriteBytes += payload.byteLength
    recording.writePromise = recording.writePromise.then(async () => {
      const result = await recording.file.write(payload)
      if (result.bytesWritten !== payload.byteLength) throw new Error(`Short recording write: ${result.bytesWritten}/${payload.byteLength}`)
    }).catch((error: unknown) => {
      recording.writeError ??= error instanceof Error ? error : new Error(String(error))
      void this.failTabCaptureRecording(recording, recording.writeError.message)
    }).finally(() => {
      recording.pendingWriteBytes -= payload.byteLength
    })
  }

  private async finishTabCaptureRecording(recording: TabCaptureRecording): Promise<void> {
    try {
      await recording.writePromise
      if (recording.writeError) throw recording.writeError
      if (recording.receivedBytes === 0) throw new Error("No tab capture data was received")
      await recording.file.sync()
      await recording.file.close()
      await fs.rename(recording.temporaryPath, recording.outputPath)
      recording.finalized = true
      recording.resolveStop?.({
        success: true,
        tabId: recording.tabId,
        duration: Date.now() - recording.startedAt,
        path: recording.outputPath,
        size: recording.receivedBytes,
        mode: "tab-capture",
        artifactType: "webm",
      })
    } catch (error) {
      recording.resolveStop?.({ success: false, error: error instanceof Error ? error.message : String(error) })
    } finally {
      await this.cleanupTabCaptureRecording(recording)
    }
  }

  private findRecording(options: RecordingTargetOptions): ActiveRecording | undefined {
    return findByRecordingTarget(this.activeRecordings, options, "Multiple active recordings; provide sessionId or tabId")
  }

  private findStartingRecording(options: RecordingTargetOptions): StartingRecording | undefined {
    return findByRecordingTarget(this.startingRecordings, options, "Multiple recordings are starting; provide sessionId or tabId")
  }

  private async cleanupRecording(tabId: number): Promise<void> {
    const recording = this.activeRecordings.get(tabId)
    if (!recording) return
    if (recording.mode === "cdp") {
      await this.cancelCdpRecording(recording)
      return
    }
    if (recording.finalizePromise) return recording.finalizePromise
    return this.cleanupTabCaptureRecording(recording)
  }

  private cleanupTabCaptureRecording(recording: TabCaptureRecording, cancel?: Promise<unknown>): Promise<void> {
    if (recording.cleanupPromise) return recording.cleanupPromise
    recording.stopping = true
    if (recording.maxDurationTimer) clearTimeout(recording.maxDurationTimer)
    recording.cleanupPromise = (async () => {
      await cancel?.catch(() => {})
      await recording.writePromise.catch(() => {})
      await recording.file.close().catch(() => {})
      if (!recording.finalized) await fs.rm(recording.temporaryPath, { force: true }).catch(() => {})
      if (this.activeRecordings.get(recording.tabId) === recording) {
        this.activeRecordings.delete(recording.tabId)
      }
    })()
    return recording.cleanupPromise
  }

  private async failTabCaptureRecording(recording: TabCaptureRecording, message: string): Promise<void> {
    if (recording.stopping || recording.finalized) return
    recording.stopping = true
    recording.resolveStop?.({ success: false, error: message })
    const cancel = this.options.isExtensionConnected()
      ? this.options.sendToExtension({ method: "recording.cancel", params: { tabId: recording.tabId } })
      : undefined
    await this.cleanupTabCaptureRecording(recording, cancel)
  }

  private async startReservedRecording(options: RecordingStartOptions, starting: StartingRecording): Promise<RecordingStartResult> {
    const mode = selectRecordingMode(options)
    if (mode === "cdp") {
      return this.startCdpRecording(options, starting)
    }
    if (cdpArtifactType(options.outputPath) !== "webm") {
      return { success: false, error: "tabCapture recording output path must end in .webm; use --mode cdp for MP4" }
    }

    await fs.mkdir(path.dirname(options.outputPath), { recursive: true })
    if (starting.cancelled) return { success: false, error: "Recording was cancelled while starting" }
    const temporaryPath = `${options.outputPath}.partial-${process.pid}-${crypto.randomUUID()}`
    const file = await fs.open(temporaryPath, "wx", 0o600)
    const recording: TabCaptureRecording = {
      tabId: options.tabId,
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
      outputPath: options.outputPath,
      temporaryPath,
      file,
      mode: "tab-capture",
      artifactType: "webm",
      expectedSequence: 0,
      receivedBytes: 0,
      pendingWriteBytes: 0,
      writePromise: Promise.resolve(),
      stopping: false,
      finalized: false,
      startedAt: this.now(),
    }
    this.activeRecordings.set(options.tabId, recording)
    let result: ExtensionStartResult
    try {
      result = parseExtensionStartResult(await this.options.sendToExtension({
        method: "recording.start",
        params: recordingStartParams(options),
      }))
    } catch (error) {
      await this.cleanupRecording(options.tabId)
      throw error
    }
    if (!result.success || starting.cancelled || result.tabId !== options.tabId || this.activeRecordings.get(options.tabId) !== recording) {
      if (result.success) await this.options.sendToExtension({ method: "recording.cancel", params: { tabId: result.tabId } }).catch(() => {})
      await this.cleanupRecording(options.tabId)
      if (!result.success) return result
      return {
        success: false,
        error: starting.cancelled
          ? "Recording was cancelled while starting"
          : result.tabId !== options.tabId
            ? `Extension started recording tab ${result.tabId} instead of ${options.tabId}`
            : recording.writeError?.message ?? "Recording ended while starting",
      }
    }
    recording.startedAt = result.startedAt
    this.armMaxDuration(recording, options.maxDurationMs)
    return {
      success: true,
      tabId: result.tabId,
      startedAt: result.startedAt,
      frameRate: options.frameRate ?? 30,
      path: options.outputPath,
      mimeType: result.mimeType ?? "video/webm",
      mode: "tab-capture",
      artifactType: "webm",
    }
  }

  private async startCdpRecording(options: RecordingStartOptions, starting: StartingRecording): Promise<RecordingStartResult> {
    if (options.audio === true) {
      return { success: false, error: "CDP recording captures video frames only; audio is not supported" }
    }
    const artifactType = cdpArtifactType(options.outputPath)
    if (!artifactType) {
      return { success: false, error: "CDP recording output path must end in .webm or .mp4" }
    }
    await fs.mkdir(path.dirname(options.outputPath), { recursive: true })
    if (starting.cancelled) return { success: false, error: "Recording was cancelled while starting" }
    const frameRate = options.frameRate ?? defaultCdpFrameRate
    let size: { readonly width: number; readonly height: number }
    try {
      size = await prepareCdpScreencastViewport(this.options.sendDebuggerCommand, options.tabId)
    } catch (error) {
      return { success: false, error: `Could not prepare the page for recording: ${error instanceof Error ? error.message : String(error)}` }
    }
    if (starting.cancelled) return { success: false, error: "Recording was cancelled while starting" }
    let encoder: VideoEncoder
    try {
      encoder = await (this.options.startVideoEncoder ?? startFfmpegVideoEncoder)({
        outputPath: options.outputPath,
        artifactType,
        frameRate,
        width: size.width,
        height: size.height,
      })
    } catch (error) {
      return { success: false, error: `Could not start CDP video encoder: ${error instanceof Error ? error.message : String(error)}` }
    }
    if (starting.cancelled) {
      await encoder.cancel()
      return { success: false, error: "Recording was cancelled while starting" }
    }
    const startedAt = this.now()
    const startedMonotonicAt = this.monotonicNow()
    const recording: CdpRecording = {
      tabId: options.tabId,
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
      outputPath: options.outputPath,
      mode: "cdp",
      artifactType,
      startedAt,
      frameRate,
      encoder,
      frameCount: 0,
      sourceFrameCount: 0,
      encodedSourceFrameCount: 0,
      coalescedFrameCount: 0,
      droppedFrameCount: 0,
      pendingFrameCount: 0,
      width: size.width,
      height: size.height,
      stopped: false,
      stopping: false,
      startedMonotonicAt,
      writePromise: Promise.resolve(),
    }
    this.activeRecordings.set(options.tabId, recording)
    try {
      await this.options.sendDebuggerCommand({
        tabId: recording.tabId,
        method: "Page.startScreencast",
        params: {
          format: "jpeg",
          quality: cdpJpegQuality,
          everyNthFrame: 1,
        },
      })
    } catch (error) {
      await this.cleanupCdpRecording(recording)
      return { success: false, error: `Could not start CDP screencast: ${error instanceof Error ? error.message : String(error)}` }
    }
    if (starting.cancelled || this.activeRecordings.get(recording.tabId) !== recording) {
      await this.cleanupCdpRecording(recording)
      return { success: false, error: "Recording was cancelled while starting" }
    }
    this.armMaxDuration(recording, options.maxDurationMs)
    return {
      success: true,
      tabId: options.tabId,
      startedAt,
      path: options.outputPath,
      mimeType: artifactType === "mp4" ? "video/mp4" : "video/webm",
      mode: "cdp",
      artifactType,
      frameRate,
    }
  }

  private async stopCdpRecording(recording: CdpRecording): Promise<RecordingStopResult> {
    if (recording.stopPromise) return recording.stopPromise
    recording.stopping = true
    if (recording.maxDurationTimer) clearTimeout(recording.maxDurationTimer)
    const stopPromise = this.finishCdpRecording(recording).finally(() => {
      if (this.activeRecordings.get(recording.tabId) === recording) {
        this.activeRecordings.delete(recording.tabId)
      }
      recording.stopped = true
    })
    recording.stopPromise = stopPromise
    return stopPromise
  }

  private async cancelCdpRecording(recording: CdpRecording): Promise<void> {
    if (recording.stopPromise) {
      await recording.stopPromise.catch(() => {})
      return
    }
    await this.cleanupCdpRecording(recording)
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }

  private armMaxDuration(recording: ActiveRecording, requestedMaxDurationMs: number | undefined): void {
    const maxDurationMs = requestedMaxDurationMs ?? defaultMaxDurationMs
    if (maxDurationMs <= 0 || !Number.isFinite(maxDurationMs)) return
    recording.maxDurationTimer = setTimeout(() => {
      void this.stopRecording({ tabId: recording.tabId }).catch((error) => {
        console.error("Recording max duration stop failed", error)
      })
    }, maxDurationMs)
  }

  private monotonicNow(): number {
    return this.options.monotonicNow?.() ?? this.options.now?.() ?? performance.now()
  }

  private async finishCdpRecording(recording: CdpRecording): Promise<RecordingStopResult> {
    const stoppedAt = this.now()
    const stoppedMonotonicAt = this.monotonicNow()
    try {
      await this.options.sendDebuggerCommand({ tabId: recording.tabId, method: "Page.stopScreencast", params: {} }).catch(() => {})
      await recording.writePromise
      if (recording.writeError) throw recording.writeError
      if (!recording.lastFrame) {
        const screenshot = await this.options.sendDebuggerCommand({
          tabId: recording.tabId,
          method: "Page.captureScreenshot",
          params: { format: "jpeg", quality: cdpJpegQuality, fromSurface: true, captureBeyondViewport: false },
        })
        const screenshotData = getString(screenshot, "data")
        if (screenshotData === undefined) throw new Error("No video frames were captured")
        recording.lastFrame = { buffer: Buffer.from(screenshotData, "base64"), frameNumber: 0 }
      }
      const durationMs = Math.max(0, stoppedMonotonicAt - recording.startedMonotonicAt)
      const expectedFrameCount = Math.max(1, Math.round((durationMs / 1_000) * recording.frameRate))
      const endFrameNumber = Math.max(recording.lastFrame.frameNumber + 1, expectedFrameCount)
      await this.writeSourceFrame(recording, recording.lastFrame, endFrameNumber)
      recording.frameCount = endFrameNumber
      await recording.encoder.finish()

      const stat = await fs.stat(recording.outputPath)
      const quality = recordingQuality(recording, durationMs)
      const metadata = {
        mode: "cdp",
        artifactType: recording.artifactType,
        tabId: recording.tabId,
        ...(recording.sessionId ? { sessionId: recording.sessionId } : {}),
        startedAt: new Date(recording.startedAt).toISOString(),
        stoppedAt: new Date(stoppedAt).toISOString(),
        durationMs,
        frameCount: recording.frameCount,
        ...quality,
        mimeType: recording.artifactType === "mp4" ? "video/mp4" : "video/webm",
      }
      await fs.writeFile(`${recording.outputPath}.json`, `${JSON.stringify(metadata, null, 2)}\n`, "utf8")
      return {
        success: true,
        tabId: recording.tabId,
        duration: durationMs,
        path: recording.outputPath,
        size: stat.size,
        mode: "cdp",
        artifactType: recording.artifactType,
        frameCount: recording.frameCount,
        quality,
      }
    } catch (error) {
      await recording.encoder.cancel().catch(() => {})
      return { success: false, error: `CDP video encoding failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  private cleanupCdpRecording(recording: CdpRecording): Promise<void> {
    if (recording.cleanupPromise) return recording.cleanupPromise
    recording.stopped = true
    if (recording.maxDurationTimer) clearTimeout(recording.maxDurationTimer)
    recording.cleanupPromise = (async () => {
      await Promise.all([
        this.options.sendDebuggerCommand({ tabId: recording.tabId, method: "Page.stopScreencast", params: {} }).catch(() => {}),
        recording.encoder.cancel().catch(() => {}),
      ])
      await recording.writePromise.catch(() => {})
      if (this.activeRecordings.get(recording.tabId) === recording) {
        this.activeRecordings.delete(recording.tabId)
      }
    })()
    return recording.cleanupPromise
  }

  private async writeSourceFrame(recording: CdpRecording, frame: CdpVideoFrame, endFrameNumber: number): Promise<void> {
    const timestampMs = Math.round((frame.frameNumber * 1_000) / recording.frameRate)
    const durationMs = Math.max(1, Math.round(((endFrameNumber - frame.frameNumber) * 1_000) / recording.frameRate))
    await recording.encoder.write(frame.buffer, timestampMs, durationMs, frame.surfaceWidth)
    recording.encodedSourceFrameCount += 1
  }
}

function selectRecordingMode(options: RecordingStartOptions): ActiveRecordingMode {
  if (options.mode === "cdp") {
    return "cdp"
  }
  if (options.mode === "tab-capture") {
    return "tab-capture"
  }
  return options.owner === "relay" ? "cdp" : "tab-capture"
}

function recordingStartParams(options: RecordingStartOptions): JsonObject {
  return {
    tabId: options.tabId,
    ...(options.frameRate === undefined ? {} : { frameRate: options.frameRate }),
    ...(options.audio === undefined ? {} : { audio: options.audio }),
    ...(options.videoBitsPerSecond === undefined ? {} : { videoBitsPerSecond: options.videoBitsPerSecond }),
    ...(options.audioBitsPerSecond === undefined ? {} : { audioBitsPerSecond: options.audioBitsPerSecond }),
  }
}

const ExtensionStartResultSchema = Schema.Union([
  Schema.Struct({
    success: Schema.Literal(true),
    tabId: Schema.Number,
    startedAt: Schema.Number,
    mimeType: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    success: Schema.Literal(false),
    error: Schema.String,
  }),
])
const decodeExtensionStartResult = Schema.decodeUnknownOption(ExtensionStartResultSchema)

const ExtensionStopResultSchema = Schema.Union([
  Schema.Struct({
    success: Schema.Literal(true),
    tabId: Schema.Number,
    duration: Schema.Number,
  }),
  Schema.Struct({
    success: Schema.Literal(false),
    error: Schema.String,
  }),
])
const decodeExtensionStopResult = Schema.decodeUnknownOption(ExtensionStopResultSchema)

function parseExtensionStartResult(value: JsonObject): ExtensionStartResult {
  return Option.getOrElse(decodeExtensionStartResult(value), () => ({
    success: false,
    error: "Invalid recording.start response from extension",
  }))
}

function parseExtensionStopResult(value: JsonObject): ExtensionStopResult {
  return Option.getOrElse(decodeExtensionStopResult(value), () => ({
    success: false,
    error: "Invalid recording.stop response from extension",
  }))
}

function parseExtensionStatusResult(value: JsonObject): ExtensionStatusResult {
  return {
    isRecording: value.isRecording === true,
    ...(Predicate.isNumber(value.tabId) ? { tabId: value.tabId } : {}),
    ...(Predicate.isNumber(value.startedAt) ? { startedAt: value.startedAt } : {}),
  }
}

function parseCancelResult(value: JsonObject): RecordingCancelResult {
  return {
    success: value.success === true,
    ...(Predicate.isString(value.error) ? { error: value.error } : {}),
  }
}

export function findByRecordingTarget<T extends { readonly sessionId?: string }>(
  map: ReadonlyMap<number, T>,
  target: RecordingTargetOptions,
  ambiguousMessage: string,
): T | undefined {
  if (target.tabId !== undefined) return map.get(target.tabId)
  if (target.sessionId) return [...map.values()].find((entry) => entry.sessionId === target.sessionId)
  if (map.size > 1) throw new Error(ambiguousMessage)
  return map.values().next().value
}

export function cdpArtifactType(outputPath: string): "webm" | "mp4" | undefined {
  const extension = path.extname(outputPath).toLowerCase()
  if (extension === ".webm") return "webm"
  if (extension === ".mp4") return "mp4"
  return undefined
}

function recordingQuality(recording: CdpRecording, durationMs: number): RecordingQuality {
  const seconds = Math.max(0.001, durationMs / 1_000)
  return {
    width: recording.width,
    height: recording.height,
    frameRate: recording.frameRate,
    sourceFrameCount: recording.sourceFrameCount,
    encodedSourceFrameCount: recording.encodedSourceFrameCount,
    coalescedFrameCount: recording.coalescedFrameCount,
    droppedFrameCount: recording.droppedFrameCount,
    achievedSourceFrameRate: recording.sourceFrameCount / seconds,
    achievedEncodedSourceFrameRate: recording.encodedSourceFrameCount / seconds,
    screenshotFallback: recording.sourceFrameCount === 0 && recording.encodedSourceFrameCount > 0,
    ...(recording.sourceWidth === undefined ? {} : { sourceWidth: recording.sourceWidth }),
    ...(recording.sourceHeight === undefined ? {} : { sourceHeight: recording.sourceHeight }),
  }
}

export async function prepareCdpScreencastViewport(
  sendDebuggerCommand: SendDebuggerCommand,
  tabId: number,
): Promise<{ readonly width: number; readonly height: number }> {
  await sendDebuggerCommand({ tabId, method: "Page.bringToFront", params: {} })
  const metrics = await sendDebuggerCommand({ tabId, method: "Page.getLayoutMetrics", params: {} })
  return cdpRecordingSize(metrics)
}

function cdpRecordingSize(metrics: JsonObject): { readonly width: number; readonly height: number } {
  const viewport = getObject(metrics.cssVisualViewport) ?? getObject(metrics.visualViewport)
  const viewportWidth = Predicate.isNumber(viewport?.clientWidth) ? viewport.clientWidth : fallbackCdpWidth
  const viewportHeight = Predicate.isNumber(viewport?.clientHeight) ? viewport.clientHeight : fallbackCdpHeight
  return {
    width: Math.max(2, Math.floor(viewportWidth) & ~1),
    height: Math.max(2, Math.floor(viewportHeight) & ~1),
  }
}

export async function startFfmpegVideoEncoder(options: Parameters<StartVideoEncoder>[0]): Promise<VideoEncoder> {
  // Preserve start-time dependency errors even though geometry arrives later.
  await new Promise<void>((resolve, reject) => {
    execFile("ffmpeg", ["-version"], { timeout: 5_000 }, (error) => error ? reject(error) : resolve())
  })
  // The first compositor frame supplies the backing surface's CSS width. It can
  // differ from both the emulated viewport and the JPEG's Retina pixel width.
  let acquisition: Promise<VideoEncoder> | undefined
  let cancelled = false
  return {
    write: async (frame, timestampMs, durationMs, surfaceWidth) => {
      if (cancelled) throw new Error("ffmpeg recording was cancelled")
      acquisition ??= createFfmpegVideoEncoder({ ...options, surfaceWidth: surfaceWidth ?? options.width })
      const encoder = await acquisition
      if (cancelled) throw new Error("ffmpeg recording was cancelled")
      await encoder.write(frame, timestampMs, durationMs)
    },
    finish: async () => {
      if (!acquisition) throw new Error("No recording frames received")
      await (await acquisition).finish()
    },
    cancel: async () => {
      cancelled = true
      if (acquisition) await (await acquisition).cancel()
    },
  }
}

async function createFfmpegVideoEncoder(options: {
  readonly outputPath: string
  readonly artifactType: "webm" | "mp4"
  readonly frameRate: number
  readonly width: number
  readonly height: number
  readonly surfaceWidth: number
}): Promise<VideoEncoder> {
  const temporaryOutputPath = `${options.outputPath}.partial-${process.pid}-${crypto.randomUUID()}`
  const outputArgs = options.artifactType === "webm"
    ? ["-c:v", "libvpx", "-crf", "4", "-deadline", "good", "-cpu-used", "4", "-b:v", "6M", "-threads", "2"]
    : ["-c:v", "libx264", "-preset", "fast", "-crf", "14", "-tune", "animation", "-pix_fmt", "yuv420p", "-movflags", "+faststart"]
  const child = spawn("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "matroska",
    "-fpsprobesize",
    "0",
    "-probesize",
    "32",
    "-analyzeduration",
    "0",
    "-i",
    "pipe:0",
    "-an",
    "-r",
    String(options.frameRate),
    "-fps_mode",
    "cfr",
    "-vf",
    `scale=min(iw\\,${options.surfaceWidth}):-1:flags=lanczos,pad=ceil(max(iw\\,${options.width})/2)*2:ceil(max(ih\\,${options.height})/2)*2:0:0:gray,crop=${options.width}:${options.height}:0:0`,
    ...outputArgs,
    "-f",
    options.artifactType,
    temporaryOutputPath,
  ], { detached: process.platform !== "win32", stdio: "pipe" })
  let stderr = ""
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-8_000)
  })
  const exit = new Promise<Error | undefined>((resolve) => {
    child.once("error", (error) => resolve(error))
    child.once("close", (code, signal) => {
      if (code === 0) resolve(undefined)
      else resolve(new Error(`ffmpeg exited with ${code ?? signal ?? "unknown status"}${stderr.trim() ? `: ${stderr.trim()}` : ""}`))
    })
  })
  try {
    await once(child, "spawn")
    await writeStreamChunk(child.stdin, mjpegMatroskaHeader(options.width, options.height))
  } catch (error) {
    await exit
    await fs.rm(temporaryOutputPath, { force: true })
    throw error
  }
  let completed = false
  let finishingPromise: Promise<void> | undefined
  let cancelPromise: Promise<void> | undefined
  const terminate = async () => {
    child.stdin.destroy()
    await terminateChildProcess({ child, exit, graceMs: 2_000 })
  }
  return {
    write: async (frame, timestampMs, durationMs) => {
      if (completed || finishingPromise || cancelPromise) throw new Error("ffmpeg input closed before recording finished")
      const envelope = mjpegMatroskaFrame(timestampMs, durationMs, frame.length)
      try {
        await writeStreamChunk(child.stdin, envelope.header)
        await writeStreamChunk(child.stdin, frame)
        await writeStreamChunk(child.stdin, envelope.trailer)
      } catch (error) {
        throw new Error(`${error instanceof Error ? error.message : String(error)}${stderr.trim() ? `: ${stderr.trim()}` : ""}`)
      }
    },
    finish: async () => {
      if (completed) return
      if (cancelPromise) throw new Error("ffmpeg recording was cancelled")
      if (finishingPromise) return finishingPromise
      finishingPromise = (async () => {
        child.stdin.end()
        const exited = await waitForProcessExit(exit, 30_000)
        if (!exited) {
          await terminate()
          throw new Error("ffmpeg did not finish within 30000ms")
        }
        const error = await exit
        if (error) throw error
        await fs.rename(temporaryOutputPath, options.outputPath)
        completed = true
      })().catch(async (error: unknown) => {
        await fs.rm(temporaryOutputPath, { force: true })
        throw error
      })
      return finishingPromise
    },
    cancel: async () => {
      if (completed) return
      if (cancelPromise) return cancelPromise
      cancelPromise = (async () => {
        await terminate()
        await fs.rm(temporaryOutputPath, { force: true })
      })()
      return cancelPromise
    },
  }
}

async function writeStreamChunk(stream: NodeJS.WritableStream, chunk: Buffer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const onClose = () => {
      cleanup()
      reject(new Error("ffmpeg input closed before recording finished"))
    }
    const cleanup = () => {
      stream.removeListener("error", onError)
      stream.removeListener("close", onClose)
    }
    stream.once("error", onError)
    stream.once("close", onClose)
    stream.write(chunk, (error?: Error | null) => {
      cleanup()
      if (error) reject(error)
      else resolve()
    })
  })
}

async function waitForProcessExit(exit: Promise<Error | undefined>, timeoutMs: number): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<false>((resolve) => {
    timeout = setTimeout(() => resolve(false), timeoutMs)
  })
  const result = await Promise.race([exit.then(() => true as const), timedOut])
  if (timeout) clearTimeout(timeout)
  return result
}
