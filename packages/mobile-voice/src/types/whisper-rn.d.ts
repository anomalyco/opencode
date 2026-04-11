declare module "whisper.rn" {
  export type TranscribeOptions = {
    language?: string
    translate?: boolean
    maxLen?: number
    prompt?: string
    [key: string]: unknown
  }

  export type TranscribeResult = {
    result: string
    language: string
    segments: {
      text: string
      t0: number
      t1: number
    }[]
    isAborted?: boolean
  }

  export type TranscribeRealtimeEvent = {
    contextId: number
    jobId: number
    isCapturing: boolean
    isStoppedByAction?: boolean
    code: number
    data?: TranscribeResult
    error?: string
    processTime: number
    recordingTime: number
  }

  export type TranscribeRealtimeOptions = TranscribeOptions & {
    realtimeAudioSec?: number
    realtimeAudioSliceSec?: number
    realtimeAudioMinSec?: number
    [key: string]: unknown
  }

  export type WhisperContext = {
    id: number
    gpu: boolean
    reasonNoGPU: string
    transcribeRealtime(options?: TranscribeRealtimeOptions): Promise<{
      stop: () => Promise<void>
      subscribe: (callback: (event: TranscribeRealtimeEvent) => void) => void
    }>
    transcribeData(
      data: ArrayBuffer,
      options?: TranscribeOptions,
    ): {
      stop: () => Promise<void>
      promise: Promise<TranscribeResult>
    }
    release(): Promise<void>
  }

  export type ContextOptions = {
    filePath: string | number
    useGpu?: boolean
    useCoreMLIos?: boolean
    useFlashAttn?: boolean
  }

  export function initWhisper(options: ContextOptions): Promise<WhisperContext>
  export function releaseAllWhisper(): Promise<void>
}

declare module "whisper.rn/realtime-transcription/index" {
  import type { TranscribeOptions, TranscribeResult, WhisperContext } from "whisper.rn"

  export type RealtimeTranscribeEvent = {
    type: "start" | "transcribe" | "end" | "error"
    sliceIndex: number
    data?: TranscribeResult
    isCapturing: boolean
    processTime: number
    recordingTime: number
  }

  export type RealtimeOptions = {
    audioSliceSec?: number
    audioMinSec?: number
    maxSlicesInMemory?: number
    transcribeOptions?: TranscribeOptions
    logger?: (message: string) => void
  }

  export type RealtimeTranscriberCallbacks = {
    onTranscribe?: (event: RealtimeTranscribeEvent) => void
    onError?: (error: string) => void
    onStatusChange?: (isActive: boolean) => void
  }

  export type RealtimeTranscriberDependencies = {
    whisperContext: WhisperContext
    audioStream: unknown
    vadContext?: unknown
    fs?: unknown
  }

  export class RealtimeTranscriber {
    constructor(
      dependencies: RealtimeTranscriberDependencies,
      options?: RealtimeOptions,
      callbacks?: RealtimeTranscriberCallbacks,
    )
    start(): Promise<void>
    stop(): Promise<void>
    release(): Promise<void>
    updateCallbacks(callbacks: Partial<RealtimeTranscriberCallbacks>): void
  }
}

declare module "whisper.rn/realtime-transcription" {
  export * from "whisper.rn/realtime-transcription/index"
}

declare module "whisper.rn/src/realtime-transcription" {
  export * from "whisper.rn/realtime-transcription/index"
}

declare module "whisper.rn/realtime-transcription/adapters/AudioPcmStreamAdapter" {
  export class AudioPcmStreamAdapter {
    initialize(config: Record<string, unknown>): Promise<void>
    start(): Promise<void>
    stop(): Promise<void>
    isRecording(): boolean
    onData(callback: (data: unknown) => void): void
    onError(callback: (error: string) => void): void
    onStatusChange(callback: (isRecording: boolean) => void): void
    release(): Promise<void>
  }
}

declare module "whisper.rn/src/realtime-transcription/adapters/AudioPcmStreamAdapter" {
  export * from "whisper.rn/realtime-transcription/adapters/AudioPcmStreamAdapter"
}
