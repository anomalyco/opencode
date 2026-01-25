import { describe, expect, test } from "bun:test"
import { RealtimeProtocol } from "../../src/realtime/protocol"

describe("RealtimeProtocol", () => {
  describe("SessionConfig", () => {
    test("validates minimal session config", () => {
      const config = RealtimeProtocol.SessionConfig.parse({})
      expect(config).toEqual({})
    })

    test("validates full session config", () => {
      const config = RealtimeProtocol.SessionConfig.parse({
        type: "realtime",
        modalities: ["text", "audio"],
        voice: "alloy",
        instructions: "You are a helpful assistant",
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        input_audio_transcription: { model: "whisper-1" },
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500,
        },
        tools: [
          {
            type: "function",
            name: "get_weather",
            description: "Get the weather",
            parameters: { type: "object", properties: {} },
          },
        ],
        temperature: 0.8,
        max_response_output_tokens: "inf",
      })
      expect(config.voice).toBe("alloy")
      expect(config.turn_detection?.type).toBe("server_vad")
    })

    test("validates semantic VAD config", () => {
      const config = RealtimeProtocol.SessionConfig.parse({
        turn_detection: {
          type: "semantic_vad",
          eagerness: "medium",
        },
      })
      expect(config.turn_detection?.type).toBe("semantic_vad")
    })

    test("validates null turn detection (manual mode)", () => {
      const config = RealtimeProtocol.SessionConfig.parse({
        turn_detection: null,
      })
      expect(config.turn_detection).toBeNull()
    })
  })

  describe("Client Events", () => {
    test("validates session.update event", () => {
      const event = RealtimeProtocol.SessionUpdate.parse({
        type: "session.update",
        session: {
          voice: "echo",
          instructions: "Be concise",
        },
      })
      expect(event.type).toBe("session.update")
      expect(event.session.voice).toBe("echo")
    })

    test("validates input_audio_buffer.append event", () => {
      const event = RealtimeProtocol.InputAudioBufferAppend.parse({
        type: "input_audio_buffer.append",
        audio: "SGVsbG8gV29ybGQ=", // base64 "Hello World"
      })
      expect(event.type).toBe("input_audio_buffer.append")
      expect(event.audio).toBe("SGVsbG8gV29ybGQ=")
    })

    test("validates input_audio_buffer.commit event", () => {
      const event = RealtimeProtocol.InputAudioBufferCommit.parse({
        type: "input_audio_buffer.commit",
      })
      expect(event.type).toBe("input_audio_buffer.commit")
    })

    test("validates input_audio_buffer.clear event", () => {
      const event = RealtimeProtocol.InputAudioBufferClear.parse({
        type: "input_audio_buffer.clear",
      })
      expect(event.type).toBe("input_audio_buffer.clear")
    })

    test("validates response.create event", () => {
      const event = RealtimeProtocol.ResponseCreate.parse({
        type: "response.create",
        response: {
          modalities: ["audio"],
        },
      })
      expect(event.type).toBe("response.create")
    })

    test("validates response.cancel event", () => {
      const event = RealtimeProtocol.ResponseCancel.parse({
        type: "response.cancel",
      })
      expect(event.type).toBe("response.cancel")
    })

    test("validates conversation.item.create for function output", () => {
      const event = RealtimeProtocol.ConversationItemCreate.parse({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: "call_abc123",
          output: '{"temperature": 72}',
        },
      })
      expect(event.type).toBe("conversation.item.create")
      expect(event.item.call_id).toBe("call_abc123")
    })

    test("ClientEvent discriminates correctly", () => {
      const appendEvent = RealtimeProtocol.ClientEvent.parse({
        type: "input_audio_buffer.append",
        audio: "base64data",
      })
      expect(appendEvent.type).toBe("input_audio_buffer.append")

      const sessionEvent = RealtimeProtocol.ClientEvent.parse({
        type: "session.update",
        session: {},
      })
      expect(sessionEvent.type).toBe("session.update")
    })
  })

  describe("Server Events", () => {
    test("validates error event", () => {
      const event = RealtimeProtocol.ErrorEvent.parse({
        type: "error",
        error: {
          type: "invalid_request_error",
          code: "invalid_value",
          message: "Invalid audio format",
          param: "input_audio_format",
        },
      })
      expect(event.type).toBe("error")
      expect(event.error.message).toBe("Invalid audio format")
    })

    test("validates session.created event", () => {
      const event = RealtimeProtocol.SessionCreated.parse({
        type: "session.created",
        session: {
          voice: "alloy",
          modalities: ["text", "audio"],
        },
      })
      expect(event.type).toBe("session.created")
    })

    test("validates session.updated event", () => {
      const event = RealtimeProtocol.SessionUpdated.parse({
        type: "session.updated",
        session: {
          voice: "echo",
        },
      })
      expect(event.type).toBe("session.updated")
    })

    test("validates input_audio_buffer.speech_started event", () => {
      const event = RealtimeProtocol.InputAudioBufferSpeechStarted.parse({
        type: "input_audio_buffer.speech_started",
        audio_start_ms: 1500,
        item_id: "item_abc",
      })
      expect(event.type).toBe("input_audio_buffer.speech_started")
      expect(event.audio_start_ms).toBe(1500)
    })

    test("validates input_audio_buffer.speech_stopped event", () => {
      const event = RealtimeProtocol.InputAudioBufferSpeechStopped.parse({
        type: "input_audio_buffer.speech_stopped",
        audio_end_ms: 3200,
        item_id: "item_abc",
      })
      expect(event.type).toBe("input_audio_buffer.speech_stopped")
    })

    test("validates input_audio_buffer.committed event", () => {
      const event = RealtimeProtocol.InputAudioBufferCommitted.parse({
        type: "input_audio_buffer.committed",
        previous_item_id: "item_xyz",
        item_id: "item_abc",
      })
      expect(event.type).toBe("input_audio_buffer.committed")
    })

    test("validates transcription completed event", () => {
      const event = RealtimeProtocol.ConversationItemInputAudioTranscriptionCompleted.parse({
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "item_abc",
        content_index: 0,
        transcript: "What is the weather like?",
      })
      expect(event.transcript).toBe("What is the weather like?")
    })

    test("validates response.created event", () => {
      const event = RealtimeProtocol.ResponseCreated.parse({
        type: "response.created",
        response: {
          id: "resp_abc",
          status: "in_progress",
          output: [],
        },
      })
      expect(event.response.id).toBe("resp_abc")
    })

    test("validates response.audio.delta event", () => {
      const event = RealtimeProtocol.ResponseAudioDelta.parse({
        type: "response.audio.delta",
        response_id: "resp_abc",
        item_id: "item_xyz",
        output_index: 0,
        content_index: 0,
        delta: "base64AudioData",
      })
      expect(event.type).toBe("response.audio.delta")
      expect(event.delta).toBe("base64AudioData")
    })

    test("validates response.audio.done event", () => {
      const event = RealtimeProtocol.ResponseAudioDone.parse({
        type: "response.audio.done",
        response_id: "resp_abc",
        item_id: "item_xyz",
        output_index: 0,
        content_index: 0,
      })
      expect(event.type).toBe("response.audio.done")
    })

    test("validates response.audio_transcript.delta event", () => {
      const event = RealtimeProtocol.ResponseAudioTranscriptDelta.parse({
        type: "response.audio_transcript.delta",
        response_id: "resp_abc",
        item_id: "item_xyz",
        output_index: 0,
        content_index: 0,
        delta: "The weather",
      })
      expect(event.delta).toBe("The weather")
    })

    test("validates response.audio_transcript.done event", () => {
      const event = RealtimeProtocol.ResponseAudioTranscriptDone.parse({
        type: "response.audio_transcript.done",
        response_id: "resp_abc",
        item_id: "item_xyz",
        output_index: 0,
        content_index: 0,
        transcript: "The weather is sunny.",
      })
      expect(event.transcript).toBe("The weather is sunny.")
    })

    test("validates response.function_call_arguments.delta event", () => {
      const event = RealtimeProtocol.ResponseFunctionCallArgumentsDelta.parse({
        type: "response.function_call_arguments.delta",
        response_id: "resp_abc",
        item_id: "item_xyz",
        output_index: 0,
        call_id: "call_123",
        delta: '{"path": "/ho',
      })
      expect(event.call_id).toBe("call_123")
    })

    test("validates response.function_call_arguments.done event", () => {
      const event = RealtimeProtocol.ResponseFunctionCallArgumentsDone.parse({
        type: "response.function_call_arguments.done",
        response_id: "resp_abc",
        item_id: "item_xyz",
        output_index: 0,
        call_id: "call_123",
        name: "read_file",
        arguments: '{"path": "/home/user/config.json"}',
      })
      expect(event.name).toBe("read_file")
      expect(event.arguments).toBe('{"path": "/home/user/config.json"}')
    })

    test("validates response.done event", () => {
      const event = RealtimeProtocol.ResponseDone.parse({
        type: "response.done",
        response: {
          id: "resp_abc",
          status: "completed",
          usage: {
            total_tokens: 150,
            input_tokens: 50,
            output_tokens: 100,
            input_token_details: {
              text_tokens: 20,
              audio_tokens: 30,
            },
            output_token_details: {
              text_tokens: 40,
              audio_tokens: 60,
            },
          },
        },
      })
      expect(event.response.status).toBe("completed")
      expect(event.response.usage?.total_tokens).toBe(150)
    })

    test("ServerEvent discriminates correctly", () => {
      const audioEvent = RealtimeProtocol.ServerEvent.parse({
        type: "response.audio.delta",
        response_id: "r1",
        item_id: "i1",
        output_index: 0,
        content_index: 0,
        delta: "data",
      })
      expect(audioEvent.type).toBe("response.audio.delta")

      const errorEvent = RealtimeProtocol.ServerEvent.parse({
        type: "error",
        error: { type: "test", message: "test error" },
      })
      expect(errorEvent.type).toBe("error")
    })
  })

  describe("Helpers", () => {
    test("parseServerEvent parses valid JSON", () => {
      const json = JSON.stringify({
        type: "session.created",
        session: { voice: "alloy" },
      })
      const event = RealtimeProtocol.parseServerEvent(json)
      expect(event.type).toBe("session.created")
    })

    test("parseServerEvent throws on invalid JSON", () => {
      expect(() => RealtimeProtocol.parseServerEvent("not json")).toThrow()
    })

    test("parseServerEvent throws on invalid event", () => {
      expect(() => RealtimeProtocol.parseServerEvent('{"type": "unknown.event"}')).toThrow()
    })

    test("serializeClientEvent serializes valid event", () => {
      const json = RealtimeProtocol.serializeClientEvent({
        type: "session.update",
        session: { voice: "echo" },
      })
      const parsed = JSON.parse(json)
      expect(parsed.type).toBe("session.update")
      expect(parsed.session.voice).toBe("echo")
    })

    test("serializeClientEvent throws on invalid event", () => {
      expect(() =>
        RealtimeProtocol.serializeClientEvent({
          type: "invalid.event" as any,
        } as any),
      ).toThrow()
    })
  })
})
