import { describe, expect, test } from "bun:test"
import { MessageV2 } from "../../src/session/message-v2"
import type { Provider } from "../../src/provider/provider"

const sessionID = "session_test"
const messageID = "message_test"

const testModel: Provider.Model = {
  id: "test-model",
  providerID: "test",
  api: {
    id: "test-model",
    url: "https://example.com",
    npm: "@ai-sdk/openai",
  },
  name: "Test Model",
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  limit: { context: 0, input: 0, output: 0 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
}

function basePart(id: string) {
  return {
    id,
    sessionID,
    messageID,
  }
}

describe("realtime.types", () => {
  describe("AudioPart", () => {
    test("validates minimal AudioPart with only required fields", () => {
      const part = MessageV2.AudioPart.parse({
        ...basePart("audio_001"),
        type: "audio",
      })
      expect(part.type).toBe("audio")
      expect(part.id).toBe("audio_001")
      expect(part.sessionID).toBe(sessionID)
      expect(part.messageID).toBe(messageID)
    })

    test("validates AudioPart with transcript", () => {
      const part = MessageV2.AudioPart.parse({
        ...basePart("audio_002"),
        type: "audio",
        transcript: "Hello, how can I help you today?",
      })
      expect(part.transcript).toBe("Hello, how can I help you today?")
    })

    test("validates AudioPart with all optional fields", () => {
      const part = MessageV2.AudioPart.parse({
        ...basePart("audio_003"),
        type: "audio",
        transcript: "Test transcript",
        duration: 2.5,
        url: "data:audio/pcm;base64,SGVsbG8=",
        encoding: "pcm16",
      })
      expect(part.transcript).toBe("Test transcript")
      expect(part.duration).toBe(2.5)
      expect(part.url).toBe("data:audio/pcm;base64,SGVsbG8=")
      expect(part.encoding).toBe("pcm16")
    })

    test("validates AudioPart with different encodings", () => {
      for (const encoding of ["pcm16", "mp3", "opus"] as const) {
        const part = MessageV2.AudioPart.parse({
          ...basePart(`audio_${encoding}`),
          type: "audio",
          encoding,
        })
        expect(part.encoding).toBe(encoding)
      }
    })

    test("rejects AudioPart with invalid encoding", () => {
      expect(() =>
        MessageV2.AudioPart.parse({
          ...basePart("audio_invalid"),
          type: "audio",
          encoding: "wav",
        }),
      ).toThrow()
    })

    test("AudioPart is included in Part union", () => {
      const part = MessageV2.Part.parse({
        ...basePart("audio_union"),
        type: "audio",
        transcript: "Hello",
      })
      expect(part.type).toBe("audio")
    })
  })

  describe("RealtimeEventPart", () => {
    test("validates speech_started event", () => {
      const part = MessageV2.RealtimeEventPart.parse({
        ...basePart("event_001"),
        type: "realtime_event",
        event: "speech_started",
        time: Date.now(),
      })
      expect(part.type).toBe("realtime_event")
      expect(part.event).toBe("speech_started")
    })

    test("validates speech_stopped event", () => {
      const part = MessageV2.RealtimeEventPart.parse({
        ...basePart("event_002"),
        type: "realtime_event",
        event: "speech_stopped",
        time: Date.now(),
      })
      expect(part.event).toBe("speech_stopped")
    })

    test("validates connected event", () => {
      const part = MessageV2.RealtimeEventPart.parse({
        ...basePart("event_003"),
        type: "realtime_event",
        event: "connected",
        time: Date.now(),
      })
      expect(part.event).toBe("connected")
    })

    test("validates disconnected event", () => {
      const part = MessageV2.RealtimeEventPart.parse({
        ...basePart("event_004"),
        type: "realtime_event",
        event: "disconnected",
        time: Date.now(),
      })
      expect(part.event).toBe("disconnected")
    })

    test("validates event with optional metadata", () => {
      const part = MessageV2.RealtimeEventPart.parse({
        ...basePart("event_005"),
        type: "realtime_event",
        event: "speech_started",
        time: Date.now(),
        metadata: {
          audioStartMs: 1500,
          itemId: "item_abc",
        },
      })
      expect(part.metadata).toBeDefined()
      expect(part.metadata?.audioStartMs).toBe(1500)
    })

    test("rejects invalid event type", () => {
      expect(() =>
        MessageV2.RealtimeEventPart.parse({
          ...basePart("event_invalid"),
          type: "realtime_event",
          event: "invalid_event",
          time: Date.now(),
        }),
      ).toThrow()
    })

    test("RealtimeEventPart is included in Part union", () => {
      const part = MessageV2.Part.parse({
        ...basePart("event_union"),
        type: "realtime_event",
        event: "connected",
        time: Date.now(),
      })
      expect(part.type).toBe("realtime_event")
    })
  })

  describe("ToolStateInterrupted", () => {
    test("validates interrupted tool state", () => {
      const state = MessageV2.ToolStateInterrupted.parse({
        status: "interrupted",
        input: { path: "/home/user/file.txt" },
        reason: "user_speech",
        partialOutput: "Reading file...",
        time: {
          start: 1000,
          end: 1500,
        },
      })
      expect(state.status).toBe("interrupted")
      expect(state.reason).toBe("user_speech")
    })

    test("validates interrupted state with minimal fields", () => {
      const state = MessageV2.ToolStateInterrupted.parse({
        status: "interrupted",
        input: { cmd: "ls -la" },
        time: {
          start: 1000,
          end: 1500,
        },
      })
      expect(state.status).toBe("interrupted")
      expect(state.partialOutput).toBeUndefined()
      expect(state.reason).toBeUndefined()
    })

    test("interrupted state is included in ToolState union", () => {
      const state = MessageV2.ToolState.parse({
        status: "interrupted",
        input: { test: true },
        time: {
          start: 1000,
          end: 1500,
        },
      })
      expect(state.status).toBe("interrupted")
    })

    test("ToolPart can have interrupted state", () => {
      const part = MessageV2.ToolPart.parse({
        ...basePart("tool_interrupted"),
        type: "tool",
        callID: "call_123",
        tool: "read",
        state: {
          status: "interrupted",
          input: { path: "/test" },
          reason: "user_speech",
          time: {
            start: 1000,
            end: 1500,
          },
        },
      })
      expect(part.state.status).toBe("interrupted")
    })

    test("toModelMessages converts interrupted tools to error results", () => {
      const userID = "m-user"
      const assistantID = "m-assistant"

      const input: MessageV2.WithParts[] = [
        {
          info: {
            id: userID,
            sessionID,
            role: "user",
            time: { created: 0 },
            agent: "user",
            model: { providerID: "test", modelID: "test" },
          } as MessageV2.User,
          parts: [
            {
              id: "u1",
              sessionID,
              messageID: userID,
              type: "text",
              text: "read the file",
            },
          ] as MessageV2.Part[],
        },
        {
          info: {
            id: assistantID,
            sessionID,
            role: "assistant",
            time: { created: 0 },
            parentID: userID,
            modelID: testModel.api.id,
            providerID: testModel.providerID,
            mode: "",
            agent: "agent",
            path: { cwd: "/", root: "/" },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          } as MessageV2.Assistant,
          parts: [
            {
              id: "a1",
              sessionID,
              messageID: assistantID,
              type: "tool",
              callID: "call-interrupted",
              tool: "read",
              state: {
                status: "interrupted",
                input: { path: "/test" },
                reason: "user_speech",
                partialOutput: "Reading file...",
                time: { start: 0, end: 100 },
              },
            },
          ] as MessageV2.Part[],
        },
      ]

      const result = MessageV2.toModelMessages(input, testModel)

      expect(result).toStrictEqual([
        {
          role: "user",
          content: [{ type: "text", text: "read the file" }],
        },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call-interrupted",
              toolName: "read",
              input: { path: "/test" },
              providerExecuted: undefined,
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call-interrupted",
              toolName: "read",
              output: { type: "error-text", value: "[Tool execution was interrupted]" },
            },
          ],
        },
      ])
    })
  })
})
