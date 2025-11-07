/**
 * Microphone Capture for LiveKit
 *
 * Captures audio from system microphone using node-record-lpcm16
 * and streams it to LiveKit via AudioSource
 */

import recorder from "node-record-lpcm16"
import type { AudioSource } from "@livekit/rtc-node"

export interface MicrophoneCaptureOptions {
  sampleRate?: number
  channelCount?: number
  volume?: number
}

/**
 * Captures audio from system microphone and feeds it to LiveKit AudioSource
 */
export class MicrophoneCapture {
  private audioSource: AudioSource
  private recording: any
  private isCapturing = false
  private options: Required<MicrophoneCaptureOptions>
  private volume = 1.0
  private frameSize: number
  private currentLevel = 0
  private onLevelChange?: (level: number) => void

  constructor(audioSource: AudioSource, options: MicrophoneCaptureOptions = {}) {
    this.audioSource = audioSource
    this.options = {
      sampleRate: options.sampleRate || 48000,
      channelCount: options.channelCount || 1,
      volume: options.volume || 1.0,
    }
    this.volume = this.options.volume

    // Calculate frame size for 20ms frames (960 samples at 48kHz)
    this.frameSize = Math.floor((this.options.sampleRate / 1000) * 20)
  }

  /**
   * Start capturing audio from microphone
   */
  start(): void {
    if (this.isCapturing) {
      console.warn("[MicrophoneCapture] Already capturing")
      return
    }

    console.log("[MicrophoneCapture] Starting capture with options:", this.options)

    try {
      this.recording = recorder.record({
        sampleRate: this.options.sampleRate,
        channels: this.options.channelCount,
        audioType: "raw",
        threshold: 0,
        silence: "0",
        recorder: "sox",
      })

      this.recording
        .stream()
        .on("data", (chunk: Buffer) => this.handleAudioData(chunk))
        .on("error", (err: Error) => this.handleError(err))
        .on("end", () => {
          console.log("[MicrophoneCapture] Recording stream ended")
          this.isCapturing = false
        })

      this.isCapturing = true
      console.log("[MicrophoneCapture] Started successfully")
    } catch (error) {
      console.error("[MicrophoneCapture] Failed to start:", error)
      throw error
    }
  }

  /**
   * Stop capturing audio
   */
  stop(): void {
    if (!this.isCapturing) {
      return
    }

    console.log("[MicrophoneCapture] Stopping capture")

    if (this.recording) {
      try {
        this.recording.stop()
      } catch (error) {
        console.error("[MicrophoneCapture] Error stopping recording:", error)
      }
      this.recording = null
    }

    this.isCapturing = false
    console.log("[MicrophoneCapture] Stopped")
  }

  /**
   * Set volume level (0.0 to 1.0)
   */
  setVolume(level: number): void {
    this.volume = Math.max(0, Math.min(1, level))
    console.log("[MicrophoneCapture] Volume set to:", this.volume)
  }

  /**
   * Check if currently capturing
   */
  isActive(): boolean {
    return this.isCapturing
  }

  /**
   * Get current audio level (0.0 to 1.0)
   */
  getLevel(): number {
    return this.currentLevel
  }

  /**
   * Set callback for audio level changes
   */
  setLevelCallback(callback: (level: number) => void): void {
    this.onLevelChange = callback
  }

  /**
   * Handle incoming audio data
   */
  private handleAudioData(chunk: Buffer): void {
    if (!this.isCapturing) return

    try {
      // Convert Buffer to Int16Array (PCM16 format)
      const samples = new Int16Array(chunk.buffer, chunk.byteOffset, chunk.length / 2)

      // Calculate audio level (RMS)
      let sum = 0
      for (let i = 0; i < samples.length; i++) {
        sum += samples[i] * samples[i]
      }
      const rms = Math.sqrt(sum / samples.length)
      // Normalize to 0-1 range (32767 is max for int16)
      this.currentLevel = Math.min(1.0, rms / 32767)

      // Notify level change callback
      if (this.onLevelChange) {
        this.onLevelChange(this.currentLevel)
      }

      // Apply volume adjustment
      if (this.volume !== 1.0) {
        for (let i = 0; i < samples.length; i++) {
          samples[i] = Math.round(samples[i] * this.volume)
        }
      }

      // Send to LiveKit AudioSource
      // Note: captureFrame expects samples in the correct format
      this.audioSource.captureFrame(samples as any)
    } catch (error) {
      console.error("[MicrophoneCapture] Error processing audio data:", error)
    }
  }

  /**
   * Handle recording errors
   */
  private handleError(err: Error): void {
    console.error("[MicrophoneCapture] Recording error:", err)
    this.stop()
  }
}
