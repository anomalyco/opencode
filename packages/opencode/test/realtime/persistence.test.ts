import { describe, expect, test, beforeEach, mock } from "bun:test"
import { RealtimeProtocol } from "../../src/realtime/protocol"
import { RealtimePersistence } from "../../src/realtime/persistence"

describe("RealtimePersistence", () => {
  describe("create", () => {
    test("creates persistence handler with session and message IDs", () => {
      const handler = RealtimePersistence.create({
        sessionID: "session_123",
        messageID: "msg_456",
      })

      expect(handler).toBeDefined()
      expect(handler.sessionID).toBe("session_123")
      expect(handler.messageID).toBe("msg_456")
    })
  })

  describe("handleServerEvent", () => {
    let handler: RealtimePersistence.Handler
    let createdParts: any[]

    beforeEach(() => {
      createdParts = []
      handler = RealtimePersistence.create({
        sessionID: "session_123",
        messageID: "msg_456",
        // Mock the part creation callback
        onPartCreated: (part) => {
          createdParts.push(part)
        },
      })
    })

    describe("user transcription", () => {
      test("creates TextPart when user transcript is completed", async () => {
        const event: RealtimeProtocol.ConversationItemInputAudioTranscriptionCompleted = {
          type: "conversation.item.input_audio_transcription.completed",
          item_id: "item_001",
          content_index: 0,
          transcript: "Hello, can you help me?",
        }

        await handler.handleServerEvent(event)

        expect(createdParts).toHaveLength(1)
        expect(createdParts[0].type).toBe("text")
        expect(createdParts[0].text).toBe("Hello, can you help me?")
        expect(createdParts[0].sessionID).toBe("session_123")
        expect(createdParts[0].messageID).toBe("msg_456")
      })

      test("marks user transcript as synthetic", async () => {
        const event: RealtimeProtocol.ConversationItemInputAudioTranscriptionCompleted = {
          type: "conversation.item.input_audio_transcription.completed",
          item_id: "item_001",
          content_index: 0,
          transcript: "Test transcript",
        }

        await handler.handleServerEvent(event)

        expect(createdParts[0].synthetic).toBe(true)
      })

      test("includes metadata with item_id", async () => {
        const event: RealtimeProtocol.ConversationItemInputAudioTranscriptionCompleted = {
          type: "conversation.item.input_audio_transcription.completed",
          item_id: "item_xyz",
          content_index: 0,
          transcript: "Test",
        }

        await handler.handleServerEvent(event)

        expect(createdParts[0].metadata).toEqual({
          realtime: true,
          item_id: "item_xyz",
          source: "user_audio",
        })
      })
    })

    describe("assistant transcription", () => {
      test("accumulates transcript deltas", async () => {
        const delta1: RealtimeProtocol.ResponseAudioTranscriptDelta = {
          type: "response.audio_transcript.delta",
          response_id: "resp_001",
          item_id: "item_002",
          output_index: 0,
          content_index: 0,
          delta: "Hello, ",
        }

        const delta2: RealtimeProtocol.ResponseAudioTranscriptDelta = {
          type: "response.audio_transcript.delta",
          response_id: "resp_001",
          item_id: "item_002",
          output_index: 0,
          content_index: 0,
          delta: "how can I help?",
        }

        await handler.handleServerEvent(delta1)
        await handler.handleServerEvent(delta2)

        // Should update part with accumulated text
        expect(createdParts.length).toBeGreaterThanOrEqual(1)
        const lastPart = createdParts[createdParts.length - 1]
        expect(lastPart.text).toBe("Hello, how can I help?")
      })

      test("creates TextPart when assistant transcript is done", async () => {
        const event: RealtimeProtocol.ResponseAudioTranscriptDone = {
          type: "response.audio_transcript.done",
          response_id: "resp_001",
          item_id: "item_002",
          output_index: 0,
          content_index: 0,
          transcript: "Hello, how can I help you today?",
        }

        await handler.handleServerEvent(event)

        expect(createdParts).toHaveLength(1)
        expect(createdParts[0].type).toBe("text")
        expect(createdParts[0].text).toBe("Hello, how can I help you today?")
      })

      test("includes metadata with response info", async () => {
        const event: RealtimeProtocol.ResponseAudioTranscriptDone = {
          type: "response.audio_transcript.done",
          response_id: "resp_xyz",
          item_id: "item_abc",
          output_index: 0,
          content_index: 0,
          transcript: "Test response",
        }

        await handler.handleServerEvent(event)

        expect(createdParts[0].metadata).toEqual({
          realtime: true,
          response_id: "resp_xyz",
          item_id: "item_abc",
          source: "assistant_audio",
        })
      })

      test("finalizes part with end time on done event", async () => {
        const event: RealtimeProtocol.ResponseAudioTranscriptDone = {
          type: "response.audio_transcript.done",
          response_id: "resp_001",
          item_id: "item_002",
          output_index: 0,
          content_index: 0,
          transcript: "Final text",
        }

        await handler.handleServerEvent(event)

        expect(createdParts[0].time).toBeDefined()
        expect(createdParts[0].time.end).toBeDefined()
      })
    })

    describe("VAD events", () => {
      test("creates RealtimeEventPart for speech_started", async () => {
        const event: RealtimeProtocol.InputAudioBufferSpeechStarted = {
          type: "input_audio_buffer.speech_started",
          audio_start_ms: 1500,
          item_id: "item_vad",
        }

        await handler.handleServerEvent(event)

        expect(createdParts).toHaveLength(1)
        expect(createdParts[0].type).toBe("realtime_event")
        expect(createdParts[0].event).toBe("speech_started")
        expect(createdParts[0].metadata?.audio_start_ms).toBe(1500)
      })

      test("creates RealtimeEventPart for speech_stopped", async () => {
        const event: RealtimeProtocol.InputAudioBufferSpeechStopped = {
          type: "input_audio_buffer.speech_stopped",
          audio_end_ms: 3200,
          item_id: "item_vad",
        }

        await handler.handleServerEvent(event)

        expect(createdParts).toHaveLength(1)
        expect(createdParts[0].type).toBe("realtime_event")
        expect(createdParts[0].event).toBe("speech_stopped")
        expect(createdParts[0].metadata?.audio_end_ms).toBe(3200)
      })
    })

    describe("ignores non-persistence events", () => {
      test("ignores audio delta events", async () => {
        const event: RealtimeProtocol.ResponseAudioDelta = {
          type: "response.audio.delta",
          response_id: "resp_001",
          item_id: "item_002",
          output_index: 0,
          content_index: 0,
          delta: "base64audiodata",
        }

        await handler.handleServerEvent(event)

        // No audio parts created - we only persist transcripts
        expect(createdParts.filter((p) => p.type === "audio")).toHaveLength(0)
      })

      test("ignores session events", async () => {
        const event: RealtimeProtocol.SessionCreated = {
          type: "session.created",
          session: {
            modalities: ["text", "audio"],
          },
        }

        await handler.handleServerEvent(event)

        expect(createdParts).toHaveLength(0)
      })
    })
  })

  describe("getTranscriptParts", () => {
    test("returns all transcript parts created", async () => {
      const handler = RealtimePersistence.create({
        sessionID: "session_123",
        messageID: "msg_456",
      })

      // Simulate user and assistant transcripts
      await handler.handleServerEvent({
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "item_001",
        content_index: 0,
        transcript: "User said this",
      })

      await handler.handleServerEvent({
        type: "response.audio_transcript.done",
        response_id: "resp_001",
        item_id: "item_002",
        output_index: 0,
        content_index: 0,
        transcript: "Assistant responded",
      })

      const parts = handler.getTranscriptParts()
      expect(parts).toHaveLength(2)
      expect(parts[0].text).toBe("User said this")
      expect(parts[1].text).toBe("Assistant responded")
    })
  })

  describe("cleanup", () => {
    test("clears internal state on cleanup", async () => {
      const handler = RealtimePersistence.create({
        sessionID: "session_123",
        messageID: "msg_456",
      })

      await handler.handleServerEvent({
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "item_001",
        content_index: 0,
        transcript: "Test",
      })

      handler.cleanup()

      expect(handler.getTranscriptParts()).toHaveLength(0)
    })
  })
})
