/**
 * Realtime Persistence
 *
 * Handles persistence of realtime conversation transcripts and events.
 * Converts OpenAI Realtime API events into TextParts and RealtimeEventParts.
 */
import { RealtimeProtocol } from "./protocol"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { Log } from "../util/log"

export namespace RealtimePersistence {
  const log = Log.create({ service: "realtime.persistence" })

  // ============================================================================
  // Types
  // ============================================================================

  export interface CreateOptions {
    sessionID: string
    messageID: string
    /** Callback when a part is created/updated */
    onPartCreated?: (part: MessageV2.Part) => void
  }

  export interface Handler {
    readonly sessionID: string
    readonly messageID: string

    /** Process a server event and persist relevant data */
    handleServerEvent(event: RealtimeProtocol.ServerEvent): Promise<void>

    /** Get all transcript parts created so far */
    getTranscriptParts(): MessageV2.TextPart[]

    /** Clean up internal state */
    cleanup(): void
  }

  // ============================================================================
  // Implementation
  // ============================================================================

  export function create(options: CreateOptions): Handler {
    const { sessionID, messageID, onPartCreated } = options

    // Track created parts
    const transcriptParts: MessageV2.TextPart[] = []
    const eventParts: MessageV2.RealtimeEventPart[] = []

    // Track in-progress assistant transcript (for delta accumulation)
    let currentAssistantTranscript: {
      partId: string
      itemId: string
      text: string
      startTime: number
    } | null = null

    const createPart = (part: MessageV2.Part) => {
      onPartCreated?.(part)
    }

    const handleUserTranscript = async (
      event: RealtimeProtocol.ConversationItemInputAudioTranscriptionCompleted,
    ) => {
      const partId = Identifier.ascending("part")
      const now = Date.now()

      const part: MessageV2.TextPart = {
        id: partId,
        sessionID,
        messageID,
        type: "text",
        text: event.transcript,
        synthetic: true, // Mark as transcribed from audio
        time: {
          start: now,
          end: now,
        },
        metadata: {
          realtime: true,
          item_id: event.item_id,
          source: "user_audio",
        },
      }

      transcriptParts.push(part)
      createPart(part)

      log.info("persisted user transcript", {
        sessionID,
        messageID,
        partId,
        length: event.transcript.length,
      })
    }

    const handleAssistantTranscriptDelta = async (event: RealtimeProtocol.ResponseAudioTranscriptDelta) => {
      // Start new transcript or append to existing
      if (!currentAssistantTranscript || currentAssistantTranscript.itemId !== event.item_id) {
        currentAssistantTranscript = {
          partId: Identifier.ascending("part"),
          itemId: event.item_id,
          text: event.delta,
          startTime: Date.now(),
        }
      } else {
        currentAssistantTranscript.text += event.delta
      }

      // Create/update the part with accumulated text
      const part: MessageV2.TextPart = {
        id: currentAssistantTranscript.partId,
        sessionID,
        messageID,
        type: "text",
        text: currentAssistantTranscript.text,
        time: {
          start: currentAssistantTranscript.startTime,
        },
        metadata: {
          realtime: true,
          response_id: event.response_id,
          item_id: event.item_id,
          source: "assistant_audio",
        },
      }

      // Update or add to transcript parts
      const existingIndex = transcriptParts.findIndex((p) => p.id === currentAssistantTranscript!.partId)
      if (existingIndex >= 0) {
        transcriptParts[existingIndex] = part
      } else {
        transcriptParts.push(part)
      }

      createPart(part)
    }

    const handleAssistantTranscriptDone = async (event: RealtimeProtocol.ResponseAudioTranscriptDone) => {
      const now = Date.now()

      // Use existing part ID if we have one for this item
      const partId =
        currentAssistantTranscript?.itemId === event.item_id
          ? currentAssistantTranscript.partId
          : Identifier.ascending("part")

      const startTime = currentAssistantTranscript?.itemId === event.item_id ? currentAssistantTranscript.startTime : now

      const part: MessageV2.TextPart = {
        id: partId,
        sessionID,
        messageID,
        type: "text",
        text: event.transcript,
        time: {
          start: startTime,
          end: now,
        },
        metadata: {
          realtime: true,
          response_id: event.response_id,
          item_id: event.item_id,
          source: "assistant_audio",
        },
      }

      // Update or add to transcript parts
      const existingIndex = transcriptParts.findIndex((p) => p.id === partId)
      if (existingIndex >= 0) {
        transcriptParts[existingIndex] = part
      } else {
        transcriptParts.push(part)
      }

      createPart(part)

      // Clear current transcript
      if (currentAssistantTranscript?.itemId === event.item_id) {
        currentAssistantTranscript = null
      }

      log.info("persisted assistant transcript", {
        sessionID,
        messageID,
        partId,
        length: event.transcript.length,
      })
    }

    const handleSpeechStarted = async (event: RealtimeProtocol.InputAudioBufferSpeechStarted) => {
      const partId = Identifier.ascending("part")

      const part: MessageV2.RealtimeEventPart = {
        id: partId,
        sessionID,
        messageID,
        type: "realtime_event",
        event: "speech_started",
        time: Date.now(),
        metadata: {
          audio_start_ms: event.audio_start_ms,
          item_id: event.item_id,
        },
      }

      eventParts.push(part)
      createPart(part)
    }

    const handleSpeechStopped = async (event: RealtimeProtocol.InputAudioBufferSpeechStopped) => {
      const partId = Identifier.ascending("part")

      const part: MessageV2.RealtimeEventPart = {
        id: partId,
        sessionID,
        messageID,
        type: "realtime_event",
        event: "speech_stopped",
        time: Date.now(),
        metadata: {
          audio_end_ms: event.audio_end_ms,
          item_id: event.item_id,
        },
      }

      eventParts.push(part)
      createPart(part)
    }

    return {
      get sessionID() {
        return sessionID
      },

      get messageID() {
        return messageID
      },

      async handleServerEvent(event: RealtimeProtocol.ServerEvent) {
        switch (event.type) {
          // User transcript
          case "conversation.item.input_audio_transcription.completed":
            await handleUserTranscript(event)
            break

          // Assistant transcript (streaming)
          case "response.audio_transcript.delta":
            await handleAssistantTranscriptDelta(event)
            break

          // Assistant transcript (final)
          case "response.audio_transcript.done":
            await handleAssistantTranscriptDone(event)
            break

          // VAD events
          case "input_audio_buffer.speech_started":
            await handleSpeechStarted(event)
            break

          case "input_audio_buffer.speech_stopped":
            await handleSpeechStopped(event)
            break

          // All other events are ignored for persistence
          default:
            // Not a persistence-relevant event
            break
        }
      },

      getTranscriptParts() {
        return [...transcriptParts]
      },

      cleanup() {
        transcriptParts.length = 0
        eventParts.length = 0
        currentAssistantTranscript = null
      },
    }
  }
}
