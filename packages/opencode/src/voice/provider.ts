export namespace VoiceProvider {
  export interface TranscriptionResult {
    text: string
    duration?: number
    language?: string
  }

  export interface Config {
    model?: string
    language?: string
    temperature?: number
  }

  export interface Provider {
    id: string
    name: string
    transcribe(audio: Buffer, config?: Config): Promise<TranscriptionResult>
    isAvailable(): Promise<boolean>
  }
}
