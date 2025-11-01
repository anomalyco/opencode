/**
 * Transcription Service
 *
 * Real-time speech-to-text for LiveKit rooms using Web Speech API
 * Optional Deepgram integration for better accuracy
 */

import type {
  TranscriptionConfig,
  TranscriptionResult,
  TranscriptionEvents,
  TranscriptionError,
} from "./types"

/**
 * Speech recognition service for transcribing audio
 */
export class TranscriptionService {
  private config: TranscriptionConfig
  private recognition?: SpeechRecognition
  private isTranscribing = false
  private eventHandlers: Partial<TranscriptionEvents> = {}

  constructor(config?: Partial<TranscriptionConfig>) {
    this.config = {
      provider: config?.provider || "browser",
      language: config?.language || "en-US",
      interimResults: config?.interimResults ?? true,
      continuousMode: config?.continuousMode ?? true,
    }
  }

  // ============================================================================
  // Transcription Control
  // ============================================================================

  /**
   * Start transcription
   */
  async startTranscription(): Promise<void> {
    if (this.isTranscribing) {
      throw this.createError("Transcription already started", "browser")
    }

    if (this.config.provider === "browser") {
      await this.startBrowserRecognition()
    } else if (this.config.provider === "deepgram") {
      throw this.createError("Deepgram provider not yet implemented", "deepgram")
    } else if (this.config.provider === "openai") {
      throw this.createError("OpenAI provider not yet implemented", "openai")
    }

    this.isTranscribing = true
    this.emit("started")
  }

  /**
   * Stop transcription
   */
  async stopTranscription(): Promise<void> {
    if (!this.isTranscribing) return

    if (this.recognition) {
      this.recognition.stop()
      this.recognition = undefined
    }

    this.isTranscribing = false
    this.emit("stopped")
  }

  /**
   * Check if currently transcribing
   */
  isActive(): boolean {
    return this.isTranscribing
  }

  // ============================================================================
  // Configuration
  // ============================================================================

  /**
   * Set transcription language
   */
  setLanguage(language: string): void {
    this.config.language = language

    if (this.recognition) {
      this.recognition.lang = language
    }
  }

  /**
   * Set transcription provider
   */
  setProvider(provider: "browser" | "deepgram" | "openai"): void {
    if (this.isTranscribing) {
      throw this.createError("Cannot change provider while transcribing", this.config.provider)
    }
    this.config.provider = provider
  }

  /**
   * Get current configuration
   */
  getConfig(): TranscriptionConfig {
    return { ...this.config }
  }

  // ============================================================================
  // Browser Web Speech API
  // ============================================================================

  /**
   * Start browser-based speech recognition
   */
  private async startBrowserRecognition(): Promise<void> {
    if (typeof window === "undefined") {
      throw this.createError("Web Speech API not available in Node.js environment", "browser")
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition

    if (!SpeechRecognition) {
      throw this.createError("Web Speech API not supported in this browser", "browser")
    }

    this.recognition = new SpeechRecognition()

    if (!this.recognition) {
      throw this.createError("Failed to create speech recognition instance", "browser")
    }

    this.recognition.lang = this.config.language
    this.recognition.continuous = this.config.continuousMode
    this.recognition.interimResults = this.config.interimResults
    this.recognition.maxAlternatives = 1

    // Handle results
    this.recognition.onresult = (event: SpeechRecognitionEvent) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const transcript = result[0].transcript
        const confidence = result[0].confidence

        const transcriptionResult: TranscriptionResult = {
          text: transcript.trim(),
          isFinal: result.isFinal,
          confidence,
          speaker: "local", // Browser API doesn't identify speakers
          timestamp: Date.now(),
        }

        if (result.isFinal) {
          this.emit("final", transcriptionResult)
        } else {
          this.emit("interim", transcriptionResult)
        }
      }
    }

    // Handle errors
    this.recognition.onerror = (event: any) => {
      const error = this.createError(`Speech recognition error: ${event.error}`, "browser")
      this.emit("error", error)

      // Auto-restart on network errors
      if (event.error === "network" && this.config.continuousMode) {
        setTimeout(() => {
          if (this.recognition && this.isTranscribing) {
            this.recognition.start()
          }
        }, 1000)
      }
    }

    // Handle end event (restart if continuous)
    this.recognition.onend = () => {
      if (this.config.continuousMode && this.isTranscribing) {
        // Restart recognition
        setTimeout(() => {
          if (this.recognition && this.isTranscribing) {
            this.recognition.start()
          }
        }, 100)
      }
    }

    this.recognition.start()
  }

  // ============================================================================
  // Event Handling
  // ============================================================================

  /**
   * Register event handler
   */
  on<K extends keyof TranscriptionEvents>(event: K, handler: TranscriptionEvents[K]): void {
    this.eventHandlers[event] = handler as any
  }

  /**
   * Unregister event handler
   */
  off<K extends keyof TranscriptionEvents>(event: K): void {
    delete this.eventHandlers[event]
  }

  /**
   * Emit event to registered handlers
   */
  private emit<K extends keyof TranscriptionEvents>(
    event: K,
    ...args: Parameters<TranscriptionEvents[K]>
  ): void {
    const handler = this.eventHandlers[event]
    if (handler) {
      ;(handler as any)(...args)
    }
  }

  // ============================================================================
  // Error Handling
  // ============================================================================

  /**
   * Create typed transcription error
   */
  private createError(message: string, provider: string): TranscriptionError {
    const error: TranscriptionError = new Error(message) as any
    error.provider = provider
    error.name = "TranscriptionError"
    return error
  }
}

/**
 * Create a transcription service instance
 */
export function createTranscriptionService(
  config?: Partial<TranscriptionConfig>,
): TranscriptionService {
  return new TranscriptionService(config)
}

// ============================================================================
// Browser Speech Recognition Types
// ============================================================================

interface SpeechRecognition extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: any) => void) | null
  onend: (() => void) | null
}

interface SpeechRecognitionEvent extends Event {
  resultIndex: number
  results: SpeechRecognitionResultList
}

interface SpeechRecognitionResultList {
  length: number
  item(index: number): SpeechRecognitionResult
  [index: number]: SpeechRecognitionResult
}

interface SpeechRecognitionResult {
  isFinal: boolean
  length: number
  item(index: number): SpeechRecognitionAlternative
  [index: number]: SpeechRecognitionAlternative
}

interface SpeechRecognitionAlternative {
  transcript: string
  confidence: number
}
