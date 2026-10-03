// Ported from anomalyco/browser-control extension/src/recording-types.ts.
export type ChromeTabCaptureAudioConstraints = {
  readonly mandatory: {
    readonly chromeMediaSource: "tab"
    readonly chromeMediaSourceId: string
  }
}

export type ChromeTabCaptureVideoConstraints = {
  readonly mandatory: {
    readonly chromeMediaSource: "tab"
    readonly chromeMediaSourceId: string
    readonly minFrameRate?: number
    readonly maxFrameRate?: number
  }
}

export type OffscreenStartRecordingMessage = {
  readonly action: "recording.start"
  readonly tabId: number
  readonly streamId: string
  readonly frameRate: number
  readonly videoBitsPerSecond: number
  readonly audioBitsPerSecond: number
  readonly audio: boolean
}

export type OffscreenStopRecordingMessage = {
  readonly action: "recording.stop"
  readonly tabId: number
}

export type OffscreenStatusRecordingMessage = {
  readonly action: "recording.status"
  readonly tabId: number
}

export type OffscreenCancelRecordingMessage = {
  readonly action: "recording.cancel"
  readonly tabId: number
}

type OffscreenCancelAllRecordingsMessage = {
  readonly action: "recording.cancelAll"
}

export type OffscreenMessage =
  | OffscreenStartRecordingMessage
  | OffscreenStopRecordingMessage
  | OffscreenStatusRecordingMessage
  | OffscreenCancelRecordingMessage
  | OffscreenCancelAllRecordingsMessage

export type OffscreenStartRecordingResult =
  | {
    readonly success: true
    readonly tabId: number
    readonly startedAt: number
    readonly mimeType: string
  }
  | {
    readonly success: false
    readonly error: string
  }

export type OffscreenStopRecordingResult =
  | {
    readonly success: true
    readonly tabId: number
    readonly duration: number
  }
  | {
    readonly success: false
    readonly error: string
  }

export type OffscreenStatusRecordingResult = {
  readonly isRecording: boolean
  readonly tabId?: number
  readonly startedAt?: number
}

export type OffscreenCancelRecordingResult =
  | {
    readonly success: true
    readonly tabId: number
  }
  | {
    readonly success: false
    readonly error: string
  }

export type OffscreenCancelAllRecordingsResult =
  | { readonly success: true }
  | { readonly success: false; readonly error: string }

export type OffscreenResult =
  | OffscreenStartRecordingResult
  | OffscreenStopRecordingResult
  | OffscreenStatusRecordingResult
  | OffscreenCancelRecordingResult
  | OffscreenCancelAllRecordingsResult

type OffscreenRecordingChunkMessage =
  | {
    readonly action: "recording.chunk"
    readonly tabId: number
    readonly sequence: number
    readonly final: false
    readonly dataBase64: string
  }
  | {
    readonly action: "recording.chunk"
    readonly tabId: number
    readonly sequence: number
    readonly final: true
  }

type OffscreenRecordingCancelledMessage = {
  readonly action: "recording.cancelled"
  readonly tabId: number
}

export type OffscreenOutgoingMessage = OffscreenRecordingChunkMessage | OffscreenRecordingCancelledMessage
