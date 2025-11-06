/**
 * LiveKit Room Manager
 *
 * Simplified room connection and audio management for OpenCode
 * Uses @livekit/rtc-node for Node.js/Bun compatibility
 */

import {
  Room,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  RoomEvent,
  ConnectionState,
} from "@livekit/rtc-node"
import { AccessToken } from "livekit-server-sdk"
import type {
  LiveKitConfig,
  RoomOptions,
  RoomConnectionState,
  AudioConfig,
  MicrophoneState,
  Participant,
  AudioTrack,
  DataChannelMessage,
  RoomEvents,
  LiveKitError,
} from "./types"

/**
 * Manages LiveKit room connections and audio
 */
export class RoomManager {
  private room?: Room
  private localAudioTrack?: LocalAudioTrack
  private config: LiveKitConfig
  private audioConfig: AudioConfig
  private microphoneState: MicrophoneState
  private eventHandlers: Partial<RoomEvents> = {}

  constructor(config: LiveKitConfig) {
    this.config = config
    this.audioConfig = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      sampleRate: 48000,
      channelCount: 1,
    }
    this.microphoneState = {
      enabled: false,
      volume: 1.0,
      muted: false,
    }
  }

  // ============================================================================
  // Connection Management
  // ============================================================================

  /**
   * Connect to LiveKit server and join a room
   */
  async connect(options: RoomOptions): Promise<void> {
    try {
      const token = await this.generateToken(options)

      this.room = new Room()

      await this.room.connect(this.config.serverUrl, token, {
        autoSubscribe: options.autoSubscribe ?? true,
        dynacast: options.dynacast ?? true,
      })

      this.setupEventListeners()
    } catch (error) {
      throw this.createError("Failed to connect to LiveKit room", "CONNECT_FAILED", error)
    }
  }

  /**
   * Disconnect from current room
   */
  async disconnect(): Promise<void> {
    if (!this.room) return

    try {
      await this.disableMicrophone()
      await this.room.disconnect()
      this.room = undefined
      this.emit("disconnected")
    } catch (error) {
      throw this.createError("Failed to disconnect from room", "DISCONNECT_FAILED", error)
    }
  }

  /**
   * Get current connection state
   */
  getConnectionState(): RoomConnectionState {
    if (!this.room) {
      return {
        connected: false,
        participantCount: 0,
        audioEnabled: false,
      }
    }

    return {
      connected: this.room.connectionState === ConnectionState.CONN_CONNECTED,
      roomName: this.room.name,
      participantId: this.room.localParticipant?.identity,
      participantCount: this.room.remoteParticipants.size + 1, // +1 for local
      audioEnabled: this.microphoneState.enabled,
    }
  }

  // ============================================================================
  // Microphone Control
  // ============================================================================

  /**
   * Enable microphone and start publishing audio
   * Note: Microphone handling in rtc-node requires AudioSource setup
   * This is a placeholder that marks the mic as "enabled" in state
   */
  async enableMicrophone(): Promise<void> {
    if (!this.room) {
      throw this.createError("Not connected to a room", "NOT_CONNECTED")
    }

    // TODO: Implement AudioSource-based microphone capture
    // For now, just mark as enabled
    this.microphoneState.enabled = true
    console.log("[RoomManager] Microphone marked as enabled (AudioSource setup required)")
  }

  /**
   * Disable microphone and stop publishing audio
   */
  async disableMicrophone(): Promise<void> {
    if (!this.room) return

    // TODO: Unpublish audio track when AudioSource is implemented
    this.microphoneState.enabled = false
    console.log("[RoomManager] Microphone marked as disabled")
  }

  /**
   * Set microphone volume (0.0 to 1.0)
   */
  async setMicrophoneVolume(level: number): Promise<void> {
    if (!this.localAudioTrack) return

    const clampedLevel = Math.max(0, Math.min(1, level))
    // Note: Volume control is typically done at the audio element level
    // MediaStreamTrack doesn't have volume control
    this.microphoneState.volume = clampedLevel
  }

  /**
   * Mute/unmute microphone
   */
  async setMicrophoneMuted(muted: boolean): Promise<void> {
    if (!this.localAudioTrack) return

    await this.localAudioTrack.mute()
    this.microphoneState.muted = muted
  }

  /**
   * Get microphone state
   */
  getMicrophoneState(): MicrophoneState {
    return { ...this.microphoneState }
  }

  // ============================================================================
  // Participant Management
  // ============================================================================

  /**
   * Get all participants in the room
   */
  getParticipants(): Participant[] {
    if (!this.room) return []

    const participants: Participant[] = []

    // Add remote participants
    for (const [, participant] of this.room.remoteParticipants) {
      participants.push(this.mapParticipant(participant))
    }

    return participants
  }

  /**
   * Get all remote audio tracks
   */
  getRemoteAudioTracks(): AudioTrack[] {
    if (!this.room) return []

    const tracks: AudioTrack[] = []

    for (const [, participant] of this.room.remoteParticipants) {
      for (const [, publication] of participant.audioTrackPublications) {
        if (publication.track) {
          tracks.push({
            sid: publication.trackSid,
            participantId: participant.identity,
            enabled: !publication.isMuted,
            volume: 1.0,
          })
        }
      }
    }

    return tracks
  }

  // ============================================================================
  // Data Channel
  // ============================================================================

  /**
   * Send data to all participants or specific participant
   */
  async sendData(message: DataChannelMessage, participantId?: string): Promise<void> {
    if (!this.room) {
      throw this.createError("Not connected to a room", "NOT_CONNECTED")
    }

    try {
      const encoder = new TextEncoder()
      const data = encoder.encode(JSON.stringify(message))

      if (participantId) {
        await this.room.localParticipant.publishData(data, {
          destinationIdentities: [participantId],
        })
      } else {
        await this.room.localParticipant.publishData(data)
      }
    } catch (error) {
      throw this.createError("Failed to send data", "DATA_SEND_FAILED", error)
    }
  }

  // ============================================================================
  // Event Handling
  // ============================================================================

  /**
   * Register event handler
   */
  on<K extends keyof RoomEvents>(event: K, handler: RoomEvents[K]): void {
    this.eventHandlers[event] = handler as any
  }

  /**
   * Unregister event handler
   */
  off<K extends keyof RoomEvents>(event: K): void {
    delete this.eventHandlers[event]
  }

  /**
   * Emit event to registered handlers
   */
  private emit<K extends keyof RoomEvents>(event: K, ...args: Parameters<RoomEvents[K]>): void {
    const handler = this.eventHandlers[event]
    if (handler) {
      ;(handler as any)(...args)
    }
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
   * Generate LiveKit access token
   */
  private async generateToken(options: RoomOptions): Promise<string> {
    const token = new AccessToken(this.config.apiKey, this.config.apiSecret, {
      identity: options.participantName || "opencode-user",
      name: options.participantName,
    })

    token.addGrant({
      roomJoin: true,
      room: options.name,
      canPublish: true,
      canSubscribe: true,
    })

    return await token.toJwt()
  }

  /**
   * Setup event listeners on room
   */
  private setupEventListeners(): void {
    if (!this.room) return

    this.room.on(RoomEvent.Connected, () => {
      this.emit("connected", this.getConnectionState())
    })

    this.room.on(RoomEvent.Disconnected, (reason) => {
      this.emit("disconnected", reason?.toString())
    })

    this.room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
      this.emit("participantJoined", this.mapParticipant(participant))
    })

    this.room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
      this.emit("participantLeft", this.mapParticipant(participant))
    })

    this.room.on(
      RoomEvent.TrackSubscribed,
      (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (track.kind === "audio") {
          this.emit(
            "audioTrackSubscribed",
            {
              sid: publication.trackSid,
              participantId: participant.identity,
              enabled: !publication.isMuted,
              volume: 1.0,
            },
            this.mapParticipant(participant),
          )
        }
      },
    )

    this.room.on(
      RoomEvent.TrackUnsubscribed,
      (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (track.kind === "audio") {
          this.emit(
            "audioTrackUnsubscribed",
            {
              sid: publication.trackSid,
              participantId: participant.identity,
              enabled: !publication.isMuted,
              volume: 1.0,
            },
            this.mapParticipant(participant),
          )
        }
      },
    )

    this.room.on(RoomEvent.DataReceived, (payload: Uint8Array, participant?: RemoteParticipant) => {
      if (!participant) return

      try {
        const decoder = new TextDecoder()
        const text = decoder.decode(payload)
        const message = JSON.parse(text) as DataChannelMessage
        this.emit("dataReceived", message, this.mapParticipant(participant))
      } catch (error) {
        console.error("Failed to parse data message:", error)
      }
    })

    this.room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      const speakerIds = new Set(speakers.map((s) => s.identity))

      for (const [, participant] of this.room!.remoteParticipants) {
        const isSpeaking = speakerIds.has(participant.identity)
        this.emit("speakingChanged", this.mapParticipant(participant), isSpeaking)
      }
    })
  }

  /**
   * Map LiveKit participant to our type
   */
  private mapParticipant(participant: RemoteParticipant): Participant {
    return {
      id: participant.sid,
      identity: participant.identity,
      name: participant.name || participant.identity,
      metadata: participant.metadata ? JSON.parse(participant.metadata) : {},
      isAgent: participant.metadata?.includes("agent") || false,
      isSpeaking: participant.isSpeaking || false,
      audioTracks: [],
      dataTracks: [],
      joinedAt: Date.now(), // TODO: Get actual join time
    }
  }

  /**
   * Create typed error
   */
  private createError(message: string, code: string, details?: any): LiveKitError {
    const error: LiveKitError = new Error(message) as any
    error.code = code
    error.details = details
    error.name = "LiveKitError"
    return error
  }
}
