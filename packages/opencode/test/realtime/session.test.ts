import { describe, expect, test, mock, beforeEach } from "bun:test"
import { RealtimeSession } from "../../src/realtime/session"
import { RealtimeTransport } from "../../src/realtime/transport"
import { RealtimeProtocol } from "../../src/realtime/protocol"

describe("RealtimeSession", () => {
  describe("state management", () => {
    test("starts in idle state", () => {
      const session = RealtimeSession.create({
        sessionID: "session_test123",
        apiKey: "test-key",
      })
      expect(session.state).toBe("idle")
    })

    test("transitions to connecting on start", async () => {
      const transport = RealtimeTransport.createMockTransport()
      const session = RealtimeSession.create({
        sessionID: "session_test123",
        transport,
      })

      const states: RealtimeSession.State[] = []
      session.on({
        onStateChange: (state) => states.push(state),
      })

      const startPromise = session.start()
      expect(states).toContain("connecting")

      await startPromise
      expect(session.state).toBe("connected")
    })

    test("transitions to disconnected on stop", async () => {
      const transport = RealtimeTransport.createMockTransport()
      const session = RealtimeSession.create({
        sessionID: "session_test123",
        transport,
      })

      await session.start()
      session.stop()

      expect(session.state).toBe("disconnected")
    })
  })

  describe("client message routing", () => {
    test("routes audio append from client to OpenAI transport", async () => {
      const transport = RealtimeTransport.createMockTransport()
      const session = RealtimeSession.create({
        sessionID: "session_test123",
        transport,
      })

      await session.start()

      // Simulate client sending audio
      session.handleClientMessage(
        JSON.stringify({
          type: "input_audio_buffer.append",
          audio: "base64audiodata",
        }),
      )

      const sent = transport.getSentEvents()
      expect(sent.some((e) => e.type === "input_audio_buffer.append")).toBe(true)
    })

    test("routes session.update from client to OpenAI transport", async () => {
      const transport = RealtimeTransport.createMockTransport()
      const session = RealtimeSession.create({
        sessionID: "session_test123",
        transport,
      })

      await session.start()

      session.handleClientMessage(
        JSON.stringify({
          type: "session.update",
          session: { voice: "alloy" },
        }),
      )

      const sent = transport.getSentEvents()
      expect(sent.some((e) => e.type === "session.update")).toBe(true)
    })

    test("ignores invalid client messages gracefully", async () => {
      const transport = RealtimeTransport.createMockTransport()
      const session = RealtimeSession.create({
        sessionID: "session_test123",
        transport,
      })

      await session.start()

      // Should not throw
      expect(() => {
        session.handleClientMessage("not valid json")
      }).not.toThrow()

      expect(() => {
        session.handleClientMessage(JSON.stringify({ type: "unknown.event" }))
      }).not.toThrow()
    })
  })

  describe("server event routing", () => {
    test("forwards server events to client handler", async () => {
      const transport = RealtimeTransport.createMockTransport()
      const session = RealtimeSession.create({
        sessionID: "session_test123",
        transport,
      })

      const clientMessages: string[] = []
      session.on({
        onClientMessage: (msg) => clientMessages.push(msg),
      })

      await session.start()

      // Simulate server sending audio
      transport.simulateServerEvent({
        type: "response.audio.delta",
        response_id: "resp_1",
        item_id: "item_1",
        output_index: 0,
        content_index: 0,
        delta: "audiodata",
      })

      expect(clientMessages.length).toBeGreaterThan(0)
      const parsed = JSON.parse(clientMessages[0])
      expect(parsed.type).toBe("response.audio.delta")
    })

    test("forwards session.created on connect", async () => {
      const transport = RealtimeTransport.createMockTransport({ autoRespond: true })
      const session = RealtimeSession.create({
        sessionID: "session_test123",
        transport,
      })

      const clientMessages: string[] = []
      session.on({
        onClientMessage: (msg) => clientMessages.push(msg),
      })

      await session.start()

      // Wait for auto-response
      await new Promise((resolve) => setTimeout(resolve, 20))

      const hasSessionCreated = clientMessages.some((msg) => {
        const parsed = JSON.parse(msg)
        return parsed.type === "session.created"
      })
      expect(hasSessionCreated).toBe(true)
    })
  })

  describe("error handling", () => {
    test("emits error on transport error", async () => {
      const transport = RealtimeTransport.createMockTransport()
      const session = RealtimeSession.create({
        sessionID: "session_test123",
        transport,
      })

      const errors: Error[] = []
      session.on({
        onError: (err) => errors.push(err),
      })

      await session.start()
      transport.simulateError(new Error("Connection lost"))

      expect(errors.length).toBe(1)
      expect(errors[0].message).toBe("Connection lost")
    })

    test("transitions to error state on transport error", async () => {
      const transport = RealtimeTransport.createMockTransport()
      const session = RealtimeSession.create({
        sessionID: "session_test123",
        transport,
      })

      await session.start()
      transport.simulateError(new Error("Connection lost"))

      expect(session.state).toBe("error")
    })
  })

  describe("function call handling", () => {
    test("emits function call events", async () => {
      const transport = RealtimeTransport.createMockTransport()
      const session = RealtimeSession.create({
        sessionID: "session_test123",
        transport,
      })

      const functionCalls: RealtimeProtocol.ResponseFunctionCallArgumentsDone[] = []
      session.on({
        onFunctionCall: (call) => functionCalls.push(call),
      })

      await session.start()

      transport.simulateServerEvent({
        type: "response.function_call_arguments.done",
        response_id: "resp_1",
        item_id: "item_1",
        output_index: 0,
        call_id: "call_abc",
        name: "get_weather",
        arguments: '{"location": "San Francisco"}',
      })

      expect(functionCalls.length).toBe(1)
      expect(functionCalls[0].name).toBe("get_weather")
    })

    test("allows submitting function results", async () => {
      const transport = RealtimeTransport.createMockTransport()
      const session = RealtimeSession.create({
        sessionID: "session_test123",
        transport,
      })

      await session.start()

      session.submitFunctionResult({
        call_id: "call_abc",
        output: '{"temperature": 72}',
      })

      const sent = transport.getSentEvents()
      const itemCreate = sent.find((e) => e.type === "conversation.item.create")
      expect(itemCreate).toBeDefined()
      if (itemCreate?.type === "conversation.item.create") {
        expect(itemCreate.item.call_id).toBe("call_abc")
      }
    })
  })

  describe("session registry", () => {
    beforeEach(() => {
      // Clear registry between tests
      RealtimeSession.clearRegistry()
    })

    test("registers session on create", () => {
      const session = RealtimeSession.create({
        sessionID: "session_test123",
        apiKey: "test-key",
      })

      expect(RealtimeSession.get("session_test123")).toBe(session)
    })

    test("unregisters session on stop", async () => {
      const transport = RealtimeTransport.createMockTransport()
      const session = RealtimeSession.create({
        sessionID: "session_test123",
        transport,
      })

      await session.start()
      session.stop()

      expect(RealtimeSession.get("session_test123")).toBeUndefined()
    })

    test("returns undefined for unknown session", () => {
      expect(RealtimeSession.get("unknown_session")).toBeUndefined()
    })
  })
})
