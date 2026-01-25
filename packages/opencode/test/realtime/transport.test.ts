import { describe, expect, test } from "bun:test"
import { RealtimeTransport } from "../../src/realtime/transport"
import { RealtimeProtocol } from "../../src/realtime/protocol"

describe("RealtimeTransport", () => {
  describe("MockTransport", () => {
    test("starts in disconnected state", () => {
      const transport = RealtimeTransport.createMockTransport()
      expect(transport.state).toBe("disconnected")
    })

    test("transitions to connected state on connect", async () => {
      const transport = RealtimeTransport.createMockTransport()
      const states: RealtimeTransport.ConnectionState[] = []

      transport.on({
        onStateChange: (state) => states.push(state),
      })

      await transport.connect()

      expect(transport.state).toBe("connected")
      expect(states).toContain("connecting")
      expect(states).toContain("connected")
    })

    test("transitions to disconnected state on disconnect", async () => {
      const transport = RealtimeTransport.createMockTransport()
      await transport.connect()

      transport.disconnect()

      expect(transport.state).toBe("disconnected")
    })

    test("throws when sending while disconnected", () => {
      const transport = RealtimeTransport.createMockTransport()

      expect(() =>
        transport.send({
          type: "session.update",
          session: {},
        }),
      ).toThrow("Not connected")
    })

    test("records sent events", async () => {
      const transport = RealtimeTransport.createMockTransport()
      await transport.connect()

      transport.send({
        type: "session.update",
        session: { voice: "alloy" },
      })

      transport.send({
        type: "input_audio_buffer.append",
        audio: "base64data",
      })

      const sent = transport.getSentEvents()
      expect(sent).toHaveLength(2)
      expect(sent[0].type).toBe("session.update")
      expect(sent[1].type).toBe("input_audio_buffer.append")
    })

    test("simulates server events", async () => {
      const transport = RealtimeTransport.createMockTransport()
      const receivedEvents: RealtimeProtocol.ServerEvent[] = []

      transport.on({
        onServerEvent: (event) => receivedEvents.push(event),
      })

      await transport.connect()

      transport.simulateServerEvent({
        type: "response.audio.delta",
        response_id: "r1",
        item_id: "i1",
        output_index: 0,
        content_index: 0,
        delta: "audiodata",
      })

      expect(receivedEvents).toHaveLength(1)
      expect(receivedEvents[0].type).toBe("response.audio.delta")
    })

    test("simulates errors", async () => {
      const transport = RealtimeTransport.createMockTransport()
      const errors: Error[] = []

      transport.on({
        onError: (err) => errors.push(err),
      })

      await transport.connect()
      transport.simulateError(new Error("Connection lost"))

      expect(transport.state).toBe("error")
      expect(errors).toHaveLength(1)
      expect(errors[0].message).toBe("Connection lost")
    })

    test("simulates disconnect", async () => {
      const transport = RealtimeTransport.createMockTransport()
      await transport.connect()

      transport.simulateDisconnect()

      expect(transport.state).toBe("disconnected")
    })

    test("auto-responds to session.update when enabled", async () => {
      const transport = RealtimeTransport.createMockTransport({ autoRespond: true })
      const receivedEvents: RealtimeProtocol.ServerEvent[] = []

      transport.on({
        onServerEvent: (event) => receivedEvents.push(event),
      })

      await transport.connect()

      // Wait for session.created auto-response
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(receivedEvents.some((e) => e.type === "session.created")).toBe(true)

      transport.send({
        type: "session.update",
        session: { voice: "echo" },
      })

      // Wait for session.updated auto-response
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(receivedEvents.some((e) => e.type === "session.updated")).toBe(true)
    })
  })

  describe("OpenAI Transport Interface", () => {
    // Note: These tests verify the interface, not actual WebSocket connections
    // Integration tests with real API would require API key and be run separately

    test("createOpenAITransport returns a Transport", () => {
      const transport = RealtimeTransport.createOpenAITransport({
        apiKey: "test-key",
      })

      expect(transport.state).toBe("disconnected")
      expect(typeof transport.connect).toBe("function")
      expect(typeof transport.disconnect).toBe("function")
      expect(typeof transport.send).toBe("function")
      expect(typeof transport.on).toBe("function")
    })

    test("accepts custom model", () => {
      const transport = RealtimeTransport.createOpenAITransport({
        apiKey: "test-key",
        model: "gpt-4o-realtime-preview-2024-12-17",
      })

      expect(transport.state).toBe("disconnected")
    })

    test("accepts custom base URL", () => {
      const transport = RealtimeTransport.createOpenAITransport({
        apiKey: "test-key",
        baseUrl: "wss://custom.api.example.com/v1/realtime",
      })

      expect(transport.state).toBe("disconnected")
    })
  })

  describe("Transport Usage Patterns", () => {
    test("typical session flow with mock", async () => {
      const transport = RealtimeTransport.createMockTransport()
      const events: RealtimeProtocol.ServerEvent[] = []

      transport.on({
        onServerEvent: (event) => events.push(event),
      })

      // 1. Connect
      await transport.connect()
      expect(transport.state).toBe("connected")

      // 2. Configure session
      transport.send({
        type: "session.update",
        session: {
          voice: "alloy",
          instructions: "You are a helpful assistant",
          turn_detection: {
            type: "server_vad",
            threshold: 0.5,
          },
        },
      })

      // 3. Simulate session configured
      transport.simulateServerEvent({
        type: "session.updated",
        session: { voice: "alloy" },
      })

      // 4. Send audio
      transport.send({
        type: "input_audio_buffer.append",
        audio: Buffer.from("fake audio data").toString("base64"),
      })

      // 5. Simulate VAD detection
      transport.simulateServerEvent({
        type: "input_audio_buffer.speech_started",
        audio_start_ms: 100,
        item_id: "item_1",
      })

      transport.simulateServerEvent({
        type: "input_audio_buffer.speech_stopped",
        audio_end_ms: 2000,
        item_id: "item_1",
      })

      // 6. Simulate response
      transport.simulateServerEvent({
        type: "response.audio.delta",
        response_id: "resp_1",
        item_id: "item_2",
        output_index: 0,
        content_index: 0,
        delta: Buffer.from("response audio").toString("base64"),
      })

      transport.simulateServerEvent({
        type: "response.done",
        response: {
          id: "resp_1",
          status: "completed",
          usage: {
            total_tokens: 100,
            input_tokens: 40,
            output_tokens: 60,
          },
        },
      })

      // 7. Disconnect
      transport.disconnect()
      expect(transport.state).toBe("disconnected")

      // Verify event flow
      expect(events.map((e) => e.type)).toEqual([
        "session.updated",
        "input_audio_buffer.speech_started",
        "input_audio_buffer.speech_stopped",
        "response.audio.delta",
        "response.done",
      ])
    })

    test("function calling flow with mock", async () => {
      const transport = RealtimeTransport.createMockTransport()
      const events: RealtimeProtocol.ServerEvent[] = []

      transport.on({
        onServerEvent: (event) => events.push(event),
      })

      await transport.connect()

      // Configure with tools
      transport.send({
        type: "session.update",
        session: {
          tools: [
            {
              type: "function",
              name: "get_weather",
              description: "Get weather for a location",
              parameters: {
                type: "object",
                properties: {
                  location: { type: "string" },
                },
              },
            },
          ],
        },
      })

      // Simulate function call from model
      transport.simulateServerEvent({
        type: "response.function_call_arguments.done",
        response_id: "resp_1",
        item_id: "item_1",
        output_index: 0,
        call_id: "call_abc",
        name: "get_weather",
        arguments: '{"location": "San Francisco"}',
      })

      // Send function result
      transport.send({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: "call_abc",
          output: '{"temperature": 68, "condition": "sunny"}',
        },
      })

      // Continue response
      transport.send({
        type: "response.create",
      })

      // Verify sent events
      const sent = transport.getSentEvents()
      expect(sent.map((e) => e.type)).toEqual(["session.update", "conversation.item.create", "response.create"])
    })
  })
})
