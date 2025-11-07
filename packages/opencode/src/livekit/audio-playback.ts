/**
 * Audio Playback for LiveKit
 *
 * Plays audio from remote participants through system speakers
 * Uses the 'speaker' package for audio output
 */

import Speaker from "speaker"
import { AudioStream } from "@livekit/rtc-node"
import type { RemoteAudioTrack, AudioFrame } from "@livekit/rtc-node"

export interface AudioPlaybackOptions {
  sampleRate: number
  channelCount: number
  volume?: number
  bitDepth?: number
}

interface TrackPlayback {
  track: RemoteAudioTrack
  stream: AudioStream
  reader: ReadableStreamDefaultReader<AudioFrame>
  active: boolean
}

/**
 * Manages audio playback from LiveKit remote tracks
 */
export class AudioPlayback {
  private speaker?: Speaker
  private tracks = new Map<string, TrackPlayback>()
  private isPlaying = false
  private volume = 1.0
  private options: Required<AudioPlaybackOptions>

  constructor(options: AudioPlaybackOptions) {
    this.options = {
      sampleRate: options.sampleRate,
      channelCount: options.channelCount,
      volume: options.volume ?? 1.0,
      bitDepth: options.bitDepth ?? 16,
    }
    this.volume = this.options.volume
  }

  /**
   * Start audio playback system
   */
  start(): void {
    if (this.isPlaying) {
      console.warn("[AudioPlayback] Already playing")
      return
    }

    console.log("[AudioPlayback] Starting playback with options:", this.options)

    try {
      // Create speaker instance
      this.speaker = new Speaker({
        channels: this.options.channelCount,
        bitDepth: this.options.bitDepth,
        sampleRate: this.options.sampleRate,
      })

      this.speaker.on("error", (err) => {
        console.error("[AudioPlayback] Speaker error:", err)
      })

      this.speaker.on("close", () => {
        console.log("[AudioPlayback] Speaker closed")
        this.isPlaying = false
      })

      this.isPlaying = true

      console.log("[AudioPlayback] Started successfully")
    } catch (error) {
      console.error("[AudioPlayback] Failed to start:", error)
      throw error
    }
  }

  /**
   * Stop audio playback
   */
  stop(): void {
    if (!this.isPlaying) return

    console.log("[AudioPlayback] Stopping playback")

    // Stop all track streams
    for (const [, playback] of this.tracks) {
      playback.active = false
      try {
        playback.reader.cancel()
      } catch (error) {
        // Ignore cancellation errors
      }
    }
    this.tracks.clear()

    // Close speaker
    if (this.speaker) {
      try {
        this.speaker.end()
      } catch (error) {
        console.error("[AudioPlayback] Error closing speaker:", error)
      }
      this.speaker = undefined
    }

    this.isPlaying = false
    console.log("[AudioPlayback] Stopped")
  }

  /**
   * Add a remote audio track to playback
   */
  async addTrack(track: RemoteAudioTrack): Promise<void> {
    const trackSid = track.sid
    if (!trackSid) {
      console.error("[AudioPlayback] Track has no SID")
      return
    }

    if (this.tracks.has(trackSid)) {
      console.warn("[AudioPlayback] Track already added:", trackSid)
      return
    }

    console.log("[AudioPlayback] Adding track:", trackSid)

    try {
      // Create audio stream from track
      const stream = new AudioStream(track, this.options.sampleRate, this.options.channelCount)
      const reader = stream.getReader()

      const playback: TrackPlayback = {
        track,
        stream,
        reader,
        active: true,
      }

      this.tracks.set(trackSid, playback)

      // Start consuming stream
      this.consumeTrackStream(trackSid, playback)

      console.log("[AudioPlayback] Track added:", trackSid)
    } catch (error) {
      console.error("[AudioPlayback] Failed to add track:", error)
      throw error
    }
  }

  /**
   * Remove a track from playback
   */
  removeTrack(trackSid: string): void {
    const playback = this.tracks.get(trackSid)
    if (!playback) return

    console.log("[AudioPlayback] Removing track:", trackSid)

    playback.active = false
    try {
      playback.reader.cancel()
    } catch (error) {
      // Ignore cancellation errors
    }
    this.tracks.delete(trackSid)

    console.log("[AudioPlayback] Track removed:", trackSid)
  }

  /**
   * Set playback volume (0.0 to 1.0)
   */
  setVolume(level: number): void {
    this.volume = Math.max(0, Math.min(1, level))
    console.log("[AudioPlayback] Volume set to:", this.volume)
  }

  /**
   * Get current playback volume
   */
  getVolume(): number {
    return this.volume
  }

  /**
   * Check if playback is active
   */
  isActive(): boolean {
    return this.isPlaying
  }

  /**
   * Get number of active tracks
   */
  getTrackCount(): number {
    return this.tracks.size
  }

  /**
   * Consume audio frames from a track stream
   */
  private async consumeTrackStream(trackSid: string, playback: TrackPlayback): Promise<void> {
    console.log("[AudioPlayback] Starting stream consumption for track:", trackSid)

    try {
      while (playback.active) {
        const result = await playback.reader.read()

        if (result.done) {
          console.log("[AudioPlayback] Stream ended for track:", trackSid)
          break
        }

        // Play the audio frame
        this.playFrame(result.value)
      }
    } catch (error) {
      console.error("[AudioPlayback] Stream consumption error for track", trackSid, ":", error)
    } finally {
      // Clean up
      this.tracks.delete(trackSid)
      console.log("[AudioPlayback] Stream consumption ended for track:", trackSid)
    }
  }

  /**
   * Play an audio frame through the speaker
   */
  private playFrame(frame: AudioFrame): void {
    if (!this.speaker || !this.isPlaying) return

    try {
      // Get frame data as Int16Array
      const samples = new Int16Array(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength / 2)

      // Apply volume
      if (this.volume !== 1.0) {
        for (let i = 0; i < samples.length; i++) {
          samples[i] = Math.round(samples[i] * this.volume)
        }
      }

      // Convert to Buffer and write to speaker
      const buffer = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)
      this.speaker.write(buffer)
    } catch (error) {
      console.error("[AudioPlayback] Error playing frame:", error)
    }
  }
}

/**
 * Create an AudioPlayback instance with default settings
 */
export function createAudioPlayback(options?: Partial<AudioPlaybackOptions>): AudioPlayback {
  return new AudioPlayback({
    sampleRate: options?.sampleRate ?? 48000,
    channelCount: options?.channelCount ?? 1,
    volume: options?.volume ?? 1.0,
    bitDepth: options?.bitDepth ?? 16,
  })
}
