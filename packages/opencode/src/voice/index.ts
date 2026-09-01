export * from "./types"
export * from "./detector"
export * from "./recorder"
export * from "./whisper"

import { AudioRecorder } from "./recorder"
import { WhisperClient } from "./whisper"
import { HardwareAudioDetector } from "./detector"
import type { STTOptions, TranscriptionResult } from "./types"

export class VoiceSTTService {
  private recorder = new AudioRecorder()
  private whisper: WhisperClient

  constructor(options?: Partial<STTOptions>) {
    this.whisper = new WhisperClient(options)
  }

  public get isRecording(): boolean {
    return this.recorder.recording
  }

  public get hardwareStatus() {
    return this.recorder.status
  }

  public static checkMicrophoneAvailability() {
    return HardwareAudioDetector.detect()
  }

  public startRecording(): boolean {
    return this.recorder.start()
  }

  public async stopAndTranscribe(): Promise<TranscriptionResult | null> {
    const audio = await this.recorder.stop()
    if (!audio || audio.pcmBuffer.length === 0) return null
    return this.whisper.transcribe(audio)
  }
}
