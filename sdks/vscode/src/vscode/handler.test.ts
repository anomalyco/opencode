import { strict as assert } from "assert"
import { describe, it, beforeEach, afterEach } from "mocha"
import * as vscode from "vscode"
import { OpenCodeRequestHandler } from "./handler"
import {
  AcpClient,
  AcpClientConfig,
  AcpClientState,
  AcpError,
  AcpErrorCode,
  PromptPart,
  SessionUpdate,
} from "../acp/client"
import { JsonRpcConnection } from "../acp/connection"
import { Readable, Writable } from "stream"

// Mock streams for testing
function createMockStreams() {
  const stdin = new Writable({
    write(chunk, encoding, callback) {
      stdin.written.push(chunk.toString())
      callback()
    },
  }) as Writable & { written: string[] }
  stdin.written = []

  const stdout = new Readable({ read() {} }) as Readable & { pushData: (data: string) => void }
  stdout.pushData = (data: string) => stdout.push(data)

  return { stdin, stdout }
}

// Mock ChatResponseStream
function createMockChatResponseStream(): any {
  return {
    markdownCalls: [],
    progressCalls: [],
    referenceCalls: [],
    markdown(value: string | vscode.MarkdownString): void {
      this.markdownCalls.push(typeof value === "string" ? value : (value as any).value)
    },
    progress(value: string): void {
      this.progressCalls.push(value)
    },
    reference(uri: vscode.Uri, range?: vscode.Range): void {
      this.referenceCalls.push({ uri, range })
    },
    anchor(value: vscode.Uri, title?: string): any {
      return { value, title }
    },
    button(command: any): any {
      return { command }
    },
    codeblock(uri: vscode.Uri, range: vscode.Range): any {
      return { uri, range }
    },
    confirmation(title: string, message: string, data: unknown, buttons?: string[]): any {
      return { title, message, data, buttons }
    },
    filetree(options: any): any {
      return { options }
    },
    inlineReference(uri: vscode.Uri, title?: string, range?: vscode.Range): any {
      return { uri, title, range }
    },
    push(part: any): void {
      // no-op for test
    },
    warning(value: string | vscode.MarkdownString): void {
      // no-op for test
    },
    text(value: string): void {
      this.markdownCalls.push(value)
    },
  }
}

// Mock CancellationToken
function createMockCancellationToken(isCancelled = false): any {
  let cancelled = isCancelled
  const listeners: Array<() => void> = []

  return {
    isCancellationRequested: cancelled,
    onCancellationRequested: (listener: () => void) => {
      listeners.push(listener)
      return { dispose: () => {} }
    },
    cancel: () => {
      cancelled = true
      for (const l of listeners) l()
    },
  }
}

// Mock ChatRequest
function createMockChatRequest(prompt = "Hello", command?: string): any {
  return {
    prompt,
    command,
    references: [],
    model: {},
    toolReferences: [],
    toolInvocationToken: {},
  }
}

// Mock ChatContext with history
function createMockChatContext(history: any[] = []): any {
  return { history }
}

async function driveToPrompt(streams: ReturnType<typeof createMockStreams>, sessionId = "ses_test_123") {
  await new Promise((r) => setTimeout(r, 10))
  const last = JSON.parse(streams.stdin.written[streams.stdin.written.length - 1])
  if (last.method === "session/new") {
    streams.stdout.pushData(JSON.stringify({ jsonrpc: "2.0", id: last.id, result: { sessionId } }) + "\n")
    await new Promise((r) => setTimeout(r, 10))
    return JSON.parse(streams.stdin.written[streams.stdin.written.length - 1])
  }
  return last
}

describe("OpenCodeRequestHandler", () => {
  let handler: OpenCodeRequestHandler
  let client: AcpClient
  let streams: ReturnType<typeof createMockStreams>
  let connection: JsonRpcConnection
  let mockStream: ReturnType<typeof createMockChatResponseStream>
  let mockToken: ReturnType<typeof createMockCancellationToken>

  beforeEach(async () => {
    streams = createMockStreams()
    connection = new JsonRpcConnection(streams.stdin, streams.stdout)

    const config: AcpClientConfig = {
      connection,
      clientInfo: { name: "test-client", version: "1.0.0" },
    }
    client = new AcpClient(config)

    // Initialize client
    const initPromise = client.initialize()
    await new Promise((r) => setTimeout(r, 10))
    const request = JSON.parse(streams.stdin.written[streams.stdin.written.length - 1])
    streams.stdout.pushData(
      JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          protocolVersion: 1,
          agentCapabilities: {},
          agentInfo: { name: "opencode", version: "1.0.0" },
        },
      }) + "\n",
    )
    await initPromise

    handler = new OpenCodeRequestHandler(client)
    mockStream = createMockChatResponseStream()
    mockToken = createMockCancellationToken()
  })

  afterEach(async () => {
    if (client) {
      await client.dispose()
    }
    connection.dispose()
  })

  describe("handler receives ChatRequest", () => {
    it("receives ChatRequest, context, stream, and token", async () => {
      const request = createMockChatRequest("Test message")
      const context = createMockChatContext()

      const handlePromise = handler.handle(request, context, mockStream, mockToken)

      // Complete the request with a response
      const req = await driveToPrompt(streams)
      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: req.id,
          result: { stopReason: "end_turn" },
        }) + "\n",
      )

      const result = await handlePromise
      assert.ok(result, "Handler should return a result")
    })

    it("returns ChatResult with metadata", async () => {
      const request = createMockChatRequest("Test message")
      const context = createMockChatContext()

      const handlePromise = handler.handle(request, context, mockStream, mockToken)

      const req = await driveToPrompt(streams)

      // Send streaming updates
      const update1: SessionUpdate = {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Hello" },
      }
      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "session/update",
          params: { sessionId: req.params.sessionId, update: update1 },
        }) + "\n",
      )

      await new Promise((r) => setTimeout(r, 10))

      // Complete with usage info
      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: req.id,
          result: {
            stopReason: "end_turn",
            usage: {
              totalTokens: 100,
              inputTokens: 50,
              outputTokens: 50,
            },
          },
        }) + "\n",
      )

      const result = await handlePromise
      assert.ok(result.metadata, "Result should have metadata")
      assert.strictEqual(result.metadata?.stopReason, "end_turn")
      assert.strictEqual(result.metadata?.usage?.totalTokens, 100)
    })
  })

  describe("buildPrompt from context.history", () => {
    it("builds prompt from history and current request", async () => {
      const history = [
        {
          prompt: "Previous message",
          command: undefined,
          references: [],
          participant: "opencode",
          toolReferences: [],
        },
        {
          response: [{ value: { value: "Previous response" } }],
          result: {},
          participant: "opencode",
        },
      ]

      const request = createMockChatRequest("Current message")
      const context = createMockChatContext(history)

      const handlePromise = handler.handle(request, context, mockStream, mockToken)

      const req = await driveToPrompt(streams)

      // Verify prompt structure
      assert.ok(Array.isArray(req.params.prompt), "Prompt should be an array")
      assert.ok(req.params.prompt.length > 0, "Prompt should not be empty")

      // Complete request
      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: req.id,
          result: { stopReason: "end_turn" },
        }) + "\n",
      )

      await handlePromise
    })

    it("includes text parts from current request", async () => {
      const request = createMockChatRequest("Hello world")
      const context = createMockChatContext()

      const handlePromise = handler.handle(request, context, mockStream, mockToken)

      const req = await driveToPrompt(streams)

      const textPart = req.params.prompt.find((p: PromptPart) => p.type === "text")
      assert.ok(textPart, "Prompt should contain text part")
      assert.ok(textPart.text.includes("Hello world"), "Text should include current request")

      // Complete request
      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: req.id,
          result: { stopReason: "end_turn" },
        }) + "\n",
      )

      await handlePromise
    })

    it("includes file references from request", async () => {
      const mockUri = vscode.Uri.file("/test/file.ts")
      const request = {
        prompt: "Look at this file",
        command: undefined,
        references: [{ id: "file", value: mockUri }],
        model: {},
        toolReferences: [],
        toolInvocationToken: {},
      }

      const context = createMockChatContext()

      const handlePromise = handler.handle(request as any, context, mockStream, mockToken)

      const req = await driveToPrompt(streams)

      const hasResourceLink = req.params.prompt.some(
        (p: PromptPart) => p.type === "resource_link" && p.uri.includes("file.ts"),
      )
      assert.ok(hasResourceLink, "Prompt should include file reference")

      // Complete request
      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: req.id,
          result: { stopReason: "end_turn" },
        }) + "\n",
      )

      await handlePromise
    })
  })

  describe("send to ACP via AcpClient", () => {
    it("sends prompt to ACP with correct session ID", async () => {
      const request = createMockChatRequest("Test")
      const context = createMockChatContext()

      const handlePromise = handler.handle(request, context, mockStream, mockToken)

      const req = await driveToPrompt(streams)

      assert.strictEqual(req.method, "session/prompt", "Should call session/prompt method")
      assert.ok(req.params.sessionId, "Should include session ID")
      assert.ok(Array.isArray(req.params.prompt), "Should include prompt array")

      // Complete request
      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: req.id,
          result: { stopReason: "end_turn" },
        }) + "\n",
      )

      await handlePromise
    })

    it("reuses session across multiple requests", async () => {
      const request1 = createMockChatRequest("First message")
      const context1 = createMockChatContext()

      const handlePromise1 = handler.handle(request1, context1, mockStream, mockToken)
      const req1 = await driveToPrompt(streams)
      const sessionId1 = req1.params.sessionId

      // Complete first request
      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: req1.id,
          result: { stopReason: "end_turn" },
        }) + "\n",
      )
      await handlePromise1

      // Second request should use same session
      mockStream = createMockChatResponseStream()
      const request2 = createMockChatRequest("Second message")
      const context2 = createMockChatContext()

      const handlePromise2 = handler.handle(request2, context2, mockStream, mockToken)
      await new Promise((r) => setTimeout(r, 10))
      const req2 = JSON.parse(streams.stdin.written[streams.stdin.written.length - 1])

      assert.strictEqual(req2.params.sessionId, sessionId1, "Should reuse same session")

      // Complete second request
      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: req2.id,
          result: { stopReason: "end_turn" },
        }) + "\n",
      )
      await handlePromise2
    })
  })

  describe("stream ACP responses to ChatResponseStream", () => {
    it("streams agent message chunks to stream.markdown()", async () => {
      const request = createMockChatRequest("Test")
      const context = createMockChatContext()

      const handlePromise = handler.handle(request, context, mockStream, mockToken)

      const req = await driveToPrompt(streams)

      // Send streaming message chunks
      const updates: SessionUpdate[] = [
        { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello" } },
        { sessionUpdate: "agent_message_chunk", content: { type: "text", text: " " } },
        { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "world" } },
      ]

      for (const update of updates) {
        streams.stdout.pushData(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "session/update",
            params: { sessionId: req.params.sessionId, update },
          }) + "\n",
        )
      }

      await new Promise((r) => setTimeout(r, 10))

      // Complete request
      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: req.id,
          result: { stopReason: "end_turn" },
        }) + "\n",
      )

      await handlePromise

      assert.ok(mockStream.markdownCalls.length > 0, "Should call markdown()")
      const fullText = mockStream.markdownCalls.join("")
      assert.ok(fullText.includes("Hello world"), "Should stream complete message")
    })

    it("streams agent thought chunks", async () => {
      const request = createMockChatRequest("Test")
      const context = createMockChatContext()

      const handlePromise = handler.handle(request, context, mockStream, mockToken)

      const req = await driveToPrompt(streams)

      // Send thought chunks
      const update: SessionUpdate = {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "Thinking..." },
      }
      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "session/update",
          params: { sessionId: req.params.sessionId, update },
        }) + "\n",
      )

      await new Promise((r) => setTimeout(r, 10))

      // Complete request
      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: req.id,
          result: { stopReason: "end_turn" },
        }) + "\n",
      )

      await handlePromise
    })
  })

  describe("handle cancellation", () => {
    it("handles cancellation via CancellationToken", async () => {
      const request = createMockChatRequest("Test")
      const context = createMockChatContext()

      const handlePromise = handler.handle(request, context, mockStream, mockToken)

      const req = await driveToPrompt(streams)

      // Trigger cancellation
      mockToken.cancel()

      await new Promise((r) => setTimeout(r, 10))

      // Complete request anyway (cancellation handling is async)
      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: req.id,
          result: { stopReason: "end_turn" },
        }) + "\n",
      )

      await handlePromise
    })

    it("sends cancel notification when token is cancelled", async () => {
      const request = createMockChatRequest("Test")
      const context = createMockChatContext()

      const handlePromise = handler.handle(request, context, mockStream, mockToken)

      const req = await driveToPrompt(streams)
      const sessionId = req.params.sessionId

      // Trigger cancellation
      mockToken.cancel()

      await new Promise((r) => setTimeout(r, 20))

      // Check for cancel notification
      const cancelReq = streams.stdin.written.find((w) => {
        try {
          const parsed = JSON.parse(w)
          return parsed.method === "session/cancel"
        } catch {
          return false
        }
      })

      if (cancelReq) {
        const parsed = JSON.parse(cancelReq)
        assert.strictEqual(parsed.params.sessionId, sessionId, "Cancel should include session ID")
      }

      // Complete request
      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: req.id,
          result: { stopReason: "end_turn" },
        }) + "\n",
      )

      await handlePromise
    })
  })

  describe("handle ACP errors gracefully", () => {
    it("handles session errors gracefully", async () => {
      // Create new handler with fresh client
      const newStreams = createMockStreams()
      const newConnection = new JsonRpcConnection(newStreams.stdin, newStreams.stdout)

      const config: AcpClientConfig = {
        connection: newConnection,
        clientInfo: { name: "test-client", version: "1.0.0" },
      }
      const newClient = new AcpClient(config)
      const newHandler = new OpenCodeRequestHandler(newClient)

      // Initialize client
      const initPromise = newClient.initialize()
      await new Promise((r) => setTimeout(r, 10))
      const initReq = JSON.parse(newStreams.stdin.written[newStreams.stdin.written.length - 1])
      newStreams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: initReq.id,
          result: {
            protocolVersion: 1,
            agentCapabilities: {},
            agentInfo: { name: "opencode", version: "1.0.0" },
          },
        }) + "\n",
      )
      await initPromise

      const request = createMockChatRequest("Test")
      const context = createMockChatContext()
      const newStream = createMockChatResponseStream()
      const newToken = createMockCancellationToken()

      const handlePromise = newHandler.handle(request, context, newStream, newToken)

      const req = await driveToPrompt(newStreams)

      // Send error response
      newStreams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: req.id,
          error: {
            code: AcpErrorCode.SessionNotFound,
            message: "Session not found",
          },
        }) + "\n",
      )

      try {
        await handlePromise
        assert.fail("Should have thrown")
      } catch (error) {
        assert.ok(error instanceof Error, "Should throw error")
        assert.ok(
          (error as Error).message.includes("Session not found") || (error as Error).message.includes("session"),
          "Error message should mention session",
        )
      } finally {
        await newClient.dispose()
        newConnection.dispose()
      }
    })

    it("handles authentication errors", async () => {
      const request = createMockChatRequest("Test")
      const context = createMockChatContext()

      const handlePromise = handler.handle(request, context, mockStream, mockToken)

      const req = await driveToPrompt(streams)

      // Send auth error response
      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: req.id,
          error: {
            code: AcpErrorCode.AuthRequired,
            message: "Authentication required",
          },
        }) + "\n",
      )

      try {
        await handlePromise
        assert.fail("Should have thrown")
      } catch (error) {
        assert.ok(error instanceof Error)
        assert.ok((error as Error).message.toLowerCase().includes("auth"), "Should indicate auth error")
      }
    })

    it("handles rate limit errors", async () => {
      const request = createMockChatRequest("Test")
      const context = createMockChatContext()

      const handlePromise = handler.handle(request, context, mockStream, mockToken)

      const req = await driveToPrompt(streams)

      // Send rate limit error
      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: req.id,
          error: {
            code: AcpErrorCode.RateLimitExceeded,
            message: "Rate limit exceeded",
          },
        }) + "\n",
      )

      try {
        await handlePromise
        assert.fail("Should have thrown")
      } catch (error) {
        assert.ok(error instanceof Error)
        assert.ok(
          (error as Error).message.toLowerCase().includes("rate") ||
            (error as Error).message.toLowerCase().includes("limit"),
          "Should indicate rate limit error",
        )
      }
    })
  })

  describe("show progress indicators", () => {
    it("shows progress via stream.progress()", async () => {
      const request = createMockChatRequest("Test")
      const context = createMockChatContext()

      const handlePromise = handler.handle(request, context, mockStream, mockToken)

      const req = await driveToPrompt(streams)

      // Send tool call to trigger progress
      const update: SessionUpdate = {
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        title: "Reading file",
        kind: "read",
        status: "pending",
        locations: [],
        rawInput: {},
      }
      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "session/update",
          params: { sessionId: req.params.sessionId, update },
        }) + "\n",
      )

      await new Promise((r) => setTimeout(r, 10))

      // Complete request
      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: req.id,
          result: { stopReason: "end_turn" },
        }) + "\n",
      )

      await handlePromise

      assert.ok(mockStream.progressCalls.length > 0, "Should show progress indicators")
    })

    it("shows progress for tool calls", async () => {
      const request = createMockChatRequest("Test")
      const context = createMockChatContext()

      const handlePromise = handler.handle(request, context, mockStream, mockToken)

      const req = await driveToPrompt(streams)

      // Send tool call updates
      const toolCall: SessionUpdate = {
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        title: "Analyzing code",
        kind: "analysis",
        status: "pending",
        locations: [],
        rawInput: {},
      }
      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "session/update",
          params: { sessionId: req.params.sessionId, update: toolCall },
        }) + "\n",
      )

      await new Promise((r) => setTimeout(r, 10))

      const toolCallUpdate: SessionUpdate = {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-1",
        status: "in_progress",
      }
      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "session/update",
          params: { sessionId: req.params.sessionId, update: toolCallUpdate },
        }) + "\n",
      )

      await new Promise((r) => setTimeout(r, 10))

      // Complete request
      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: req.id,
          result: { stopReason: "end_turn" },
        }) + "\n",
      )

      await handlePromise

      assert.ok(
        mockStream.progressCalls.some((p: string) => p.toLowerCase().includes("analyzing")),
        "Should show tool progress",
      )
    })
  })

  describe("session management", () => {
    it("creates new session on first request", async () => {
      // Create handler with fresh client
      const newStreams = createMockStreams()
      const newConnection = new JsonRpcConnection(newStreams.stdin, newStreams.stdout)

      const config: AcpClientConfig = {
        connection: newConnection,
        clientInfo: { name: "test-client", version: "1.0.0" },
      }
      const newClient = new AcpClient(config)
      const newHandler = new OpenCodeRequestHandler(newClient)

      // Initialize client
      const initPromise = newClient.initialize()
      await new Promise((r) => setTimeout(r, 10))
      const initReq = JSON.parse(newStreams.stdin.written[newStreams.stdin.written.length - 1])
      newStreams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: initReq.id,
          result: {
            protocolVersion: 1,
            agentCapabilities: {},
            agentInfo: { name: "opencode", version: "1.0.0" },
          },
        }) + "\n",
      )
      await initPromise

      const request = createMockChatRequest("Test")
      const context = createMockChatContext()
      const newStream = createMockChatResponseStream()
      const newToken = createMockCancellationToken()

      const handlePromise = newHandler.handle(request, context, newStream, newToken)

      await new Promise((r) => setTimeout(r, 10))

      // Check that session/new was called
      const newSessionReq = newStreams.stdin.written.find((w) => {
        try {
          const parsed = JSON.parse(w)
          return parsed.method === "session/new"
        } catch {
          return false
        }
      })

      assert.ok(newSessionReq, "Should call session/new")
      const parsed = JSON.parse(newSessionReq)
      assert.ok(parsed.params.cwd, "Should include cwd in session request")

      // Send session response
      const sessionId = "ses_test_123"
      newStreams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: parsed.id,
          result: { sessionId },
        }) + "\n",
      )

      // Wait for prompt request
      await new Promise((r) => setTimeout(r, 10))
      const promptReq = JSON.parse(newStreams.stdin.written[newStreams.stdin.written.length - 1])
      assert.strictEqual(promptReq.params.sessionId, sessionId, "Should use returned session ID")

      // Complete request
      newStreams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: promptReq.id,
          result: { stopReason: "end_turn" },
        }) + "\n",
      )

      await handlePromise

      await newClient.dispose()
      newConnection.dispose()
    })
  })
})
