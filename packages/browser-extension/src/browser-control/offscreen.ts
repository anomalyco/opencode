// Ported from anomalyco/browser-control extension/src/offscreen.ts: records tabs with chrome.tabCapture
// and MediaRecorder in an offscreen document and streams chunks to the background for the relay.
import type {
  ChromeTabCaptureAudioConstraints,
  ChromeTabCaptureVideoConstraints,
  OffscreenCancelRecordingMessage,
  OffscreenCancelAllRecordingsResult,
  OffscreenCancelRecordingResult,
  OffscreenMessage,
  OffscreenResult,
  OffscreenStartRecordingMessage,
  OffscreenStartRecordingResult,
  OffscreenStatusRecordingMessage,
  OffscreenStatusRecordingResult,
  OffscreenStopRecordingMessage,
  OffscreenStopRecordingResult,
} from "./recording-types"
import { maxRecordingFramePayloadBytes } from "./protocol"

type RecordingState = {
  readonly recorder: MediaRecorder
  readonly stream: MediaStream
  readonly startedAt: number
  readonly tabId: number
  nextSequence: number
  sendTail: Promise<void>
  sendError?: Error
  cancelled: boolean
}

const recordings = new Map<number, RecordingState>()

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isOffscreenMessage(message)) return false
  void handleMessage(message).then(sendResponse)
  return true
})

async function handleMessage(message: OffscreenMessage): Promise<OffscreenResult> {
  if (message.action === "recording.start") {
    return handleStartRecording(message)
  }
  if (message.action === "recording.stop") {
    return handleStopRecording(message)
  }
  if (message.action === "recording.status") {
    return handleStatusRecording(message)
  }
  if (message.action === "recording.cancel") {
    return handleCancelRecording(message)
  }
  return handleCancelAllRecordings()
}

function isOffscreenMessage(message: unknown): message is OffscreenMessage {
  if (!message || typeof message !== "object" || Array.isArray(message) || !("action" in message)) return false
  return message.action === "recording.start" ||
    message.action === "recording.stop" ||
    message.action === "recording.status" ||
    message.action === "recording.cancel" ||
    message.action === "recording.cancelAll"
}

async function handleStartRecording(message: OffscreenStartRecordingMessage): Promise<OffscreenStartRecordingResult> {
  if (recordings.has(message.tabId)) {
    return { success: false, error: `Recording already in progress for tab ${message.tabId}` }
  }

  let stream: MediaStream | undefined
  try {
    const audioConstraints: ChromeTabCaptureAudioConstraints | false = message.audio
      ? {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: message.streamId,
        },
      }
      : false
    const videoConstraints: ChromeTabCaptureVideoConstraints = {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: message.streamId,
        minFrameRate: message.frameRate,
        maxFrameRate: message.frameRate,
      },
    }
    stream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints,
      video: videoConstraints,
    } as MediaStreamConstraints)
    const mimeType = selectWebmMimeType()
    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: message.videoBitsPerSecond,
      audioBitsPerSecond: message.audioBitsPerSecond,
    })
    const startedAt = Date.now()
    const recording: RecordingState = {
      recorder,
      stream,
      startedAt,
      tabId: message.tabId,
      nextSequence: 0,
      sendTail: Promise.resolve(),
      cancelled: false,
    }

    recorder.ondataavailable = (event) => {
      if (event.data.size === 0 || recording.sendError || recording.cancelled) {
        return
      }
      if (recorder.state === "recording") recorder.pause()
      recording.sendTail = recording.sendTail.then(async () => {
        try {
          for (let offset = 0; offset < event.data.size; offset += maxRecordingFramePayloadBytes) {
            const dataBase64 = await blobToBase64(event.data.slice(offset, offset + maxRecordingFramePayloadBytes))
            const result = await chrome.runtime.sendMessage({
              action: "recording.chunk",
              tabId: message.tabId,
              sequence: recording.nextSequence++,
              final: false,
              dataBase64,
            }) as { readonly success: boolean; readonly error?: string }
            if (!result.success) throw new Error(result.error ?? "Could not send recording chunk")
          }
        } catch (error) {
          recording.sendError = error instanceof Error ? error : new Error(String(error))
          handleCancelRecordingForTab(message.tabId)
        } finally {
          if (!recording.sendError && recorder.state === "paused") recorder.resume()
        }
      })
    }
    recorder.onerror = () => {
      handleCancelRecordingForTab(message.tabId)
    }

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("MediaRecorder failed to start within 5 seconds"))
      }, 5_000)
      recorder.onstart = () => {
        clearTimeout(timeout)
        resolve()
      }
      recorder.start(1_000)
    })

    recordings.set(message.tabId, recording)
    return { success: true, tabId: message.tabId, startedAt, mimeType: recorder.mimeType || mimeType || "video/webm" }
  } catch (error) {
    stream?.getTracks().map((track) => {
      track.stop()
      return undefined
    })
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function handleStopRecording(message: OffscreenStopRecordingMessage): Promise<OffscreenStopRecordingResult> {
  const recording = recordings.get(message.tabId)
  if (!recording) {
    return { success: false, error: `No active recording for tab ${message.tabId}` }
  }

  try {
    await new Promise<void>((resolve) => {
      const previousStop = recording.recorder.onstop
      recording.recorder.onstop = (event) => {
        if (previousStop) {
          previousStop.call(recording.recorder, event)
        }
        resolve()
      }
      if (recording.recorder.state === "inactive") {
        resolve()
        return
      }
      recording.recorder.stop()
    })
    await recording.sendTail
    if (recording.sendError) throw recording.sendError
    recording.stream.getTracks().map((track) => {
      track.stop()
      return undefined
    })
    recordings.delete(message.tabId)
    const finalResult = await chrome.runtime.sendMessage({
      action: "recording.chunk",
      tabId: message.tabId,
      sequence: recording.nextSequence,
      final: true,
    }) as { readonly success: boolean; readonly error?: string }
    if (!finalResult.success) throw new Error(finalResult.error ?? "Could not finish recording stream")
    return { success: true, tabId: message.tabId, duration: Date.now() - recording.startedAt }
  } catch (error) {
    handleCancelRecordingForTab(message.tabId)
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function handleStatusRecording(message: OffscreenStatusRecordingMessage): OffscreenStatusRecordingResult {
  const recording = recordings.get(message.tabId)
  if (!recording) {
    return { isRecording: false, tabId: message.tabId }
  }
  return {
    isRecording: recording.recorder.state !== "inactive",
    tabId: message.tabId,
    startedAt: recording.startedAt,
  }
}

function handleCancelRecording(message: OffscreenCancelRecordingMessage): OffscreenCancelRecordingResult {
  return handleCancelRecordingForTab(message.tabId)
}

function handleCancelAllRecordings(): OffscreenCancelAllRecordingsResult {
  let failure: OffscreenCancelAllRecordingsResult | undefined
  for (const tabId of Array.from(recordings.keys())) {
    const result = handleCancelRecordingForTab(tabId)
    if (!result.success) failure ??= result
  }
  return failure ?? { success: true }
}

function handleCancelRecordingForTab(tabId: number): OffscreenCancelRecordingResult {
  const recording = recordings.get(tabId)
  if (!recording) {
    return { success: true, tabId }
  }
  try {
    recording.cancelled = true
    if (recording.recorder.state !== "inactive") {
      recording.recorder.stop()
    }
    recording.stream.getTracks().map((track) => {
      track.stop()
      return undefined
    })
    recordings.delete(tabId)
    chrome.runtime.sendMessage({ action: "recording.cancelled", tabId })
    return { success: true, tabId }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function selectWebmMimeType(): string {
  return ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((mimeType) => {
    return MediaRecorder.isTypeSupported(mimeType)
  }) ?? ""
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== "string") {
        reject(new Error("Could not encode recording chunk"))
        return
      }
      resolve(result.slice(result.indexOf(",") + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error("Could not read recording chunk"))
    reader.readAsDataURL(blob)
  })
}
