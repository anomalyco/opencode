import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { TraceLogger } from "../../src/util/trace-logger"
import fs from "fs/promises"
import path from "path"
import os from "os"

describe("TraceLogger", () => {
  let testDir: string

  beforeEach(async () => {
    // Create a temporary directory for test traces
    testDir = path.join(os.tmpdir(), `opencode-trace-test-${Date.now()}`)
    await fs.mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true })
    } catch (e) {
      // Ignore cleanup errors
    }
  })

  it("should not be enabled by default", () => {
    expect(TraceLogger.isEnabled()).toBe(false)
  })

  it("should enable tracing when initialized with a directory", () => {
    TraceLogger.init(testDir)
    expect(TraceLogger.isEnabled()).toBe(true)
    expect(TraceLogger.getDirectory()).toBe(testDir)
  })

  it("should create a trace entry with correct structure", () => {
    const entry = TraceLogger.createTraceEntry({
      sessionID: "test-session",
      providerID: "openai",
      modelID: "gpt-4",
      agent: "default",
      system: ["System prompt"],
      messages: [{ role: "user", content: "Hello" }],
      tools: { bash: { name: "bash" } },
      parameters: {
        temperature: 0.7,
        topP: 0.9,
        maxOutputTokens: 32000,
      },
    })

    expect(entry.sessionID).toBe("test-session")
    expect(entry.providerID).toBe("openai")
    expect(entry.modelID).toBe("gpt-4")
    expect(entry.agent).toBe("default")
    expect(entry.request.messages).toEqual([
      { role: "system", content: "System prompt" },
      { role: "user", content: "Hello" },
    ])
    expect(entry.request.tools).toEqual([{ name: "bash" }])
  })

  it("should update trace entry with response data", () => {
    const entry = TraceLogger.createTraceEntry({
      sessionID: "test-session",
      providerID: "openai",
      modelID: "gpt-4",
      agent: "default",
      system: ["System prompt"],
      messages: [],
      tools: {},
      parameters: {},
    })

    TraceLogger.updateTraceWithResponse(entry, {
      finishReason: "stop",
      usage: {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      },
      content: {
        text: ["Hello, world!"],
      },
      duration: 1234,
    })

    expect(entry.response).toBeDefined()
    expect(entry.response?.choices?.[0]?.finish_reason).toBe("stop")
    expect(entry.response?.usage?.prompt_tokens).toBe(100)
    expect(entry.response?.usage?.completion_tokens).toBe(50)
    expect(entry.response?.usage?.total_tokens).toBe(150)
    expect(entry.response?.choices?.[0]?.message.content).toBe("Hello, world!")
    expect(entry.duration).toBe(1234)
  })

  it("should log trace to file when enabled", async () => {
    TraceLogger.init(testDir)

    const entry = TraceLogger.createTraceEntry({
      sessionID: "test-session",
      providerID: "openai",
      modelID: "gpt-4",
      agent: "default",
      system: ["System prompt"],
      messages: [{ role: "user", content: "Test message" }],
      tools: {},
      parameters: {},
    })

    TraceLogger.updateTraceWithResponse(entry, {
      finishReason: "stop",
      usage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      },
      content: {
        text: ["Response text"],
      },
      duration: 500,
    })

    await TraceLogger.logTrace(entry)

    // Verify file was created
    const files = await fs.readdir(testDir)
    expect(files.length).toBe(1)
    expect(files[0]).toMatch(/\.json$/)

    // Verify file contents
    const filePath = path.join(testDir, files[0])
    const content = await fs.readFile(filePath, "utf-8")
    const parsed = JSON.parse(content)

    expect(parsed.sessionID).toBe("test-session")
    expect(parsed.providerID).toBe("openai")
    expect(parsed.modelID).toBe("gpt-4")
    expect(parsed.request.messages).toEqual([
      { role: "system", content: "System prompt" },
      { role: "user", content: "Test message" },
    ])
    expect(parsed.response.choices[0].message.content).toBe("Response text")
  })

  it("should not log trace when disabled", async () => {
    // Don't initialize - tracing should be disabled
    const entry = TraceLogger.createTraceEntry({
      sessionID: "test-session",
      providerID: "openai",
      modelID: "gpt-4",
      agent: "default",
      system: [],
      messages: [],
      tools: {},
      parameters: {},
    })

    await TraceLogger.logTrace(entry)

    // Verify no files were created in test directory
    const exists = await fs
      .access(testDir)
      .then(() => true)
      .catch(() => false)
    if (exists) {
      const files = await fs.readdir(testDir)
      expect(files.length).toBe(0)
    }
  })

  it("should handle errors in trace entry", () => {
    const entry = TraceLogger.createTraceEntry({
      sessionID: "test-session",
      providerID: "openai",
      modelID: "gpt-4",
      agent: "default",
      system: [],
      messages: [],
      tools: {},
      parameters: {},
    })

    const error = new Error("Test error")
    error.stack = "Error stack trace"

    TraceLogger.updateTraceWithResponse(entry, {
      error,
      duration: 100,
    })

    expect(entry.error).toBeDefined()
    expect(entry.error?.name).toBe("Error")
    expect(entry.error?.message).toBe("Test error")
    expect(entry.error?.stack).toBe("Error stack trace")
  })

  it("should include tool calls in response", () => {
    const entry = TraceLogger.createTraceEntry({
      sessionID: "test-session",
      providerID: "openai",
      modelID: "gpt-4",
      agent: "default",
      system: [],
      messages: [],
      tools: {},
      parameters: {},
    })

    TraceLogger.updateTraceWithResponse(entry, {
      content: {
        toolCalls: [
          {
            id: "call_1",
            name: "bash",
            input: { command: "ls -la" },
          },
          {
            id: "call_2",
            name: "read_file",
            input: { path: "test.txt" },
          },
        ],
      },
      duration: 500,
    })

    expect(entry.response?.choices?.[0]?.message.tool_calls).toHaveLength(2)
    expect(entry.response?.choices?.[0]?.message.tool_calls?.[0].function.name).toBe("bash")
    expect(entry.response?.choices?.[0]?.message.tool_calls?.[1].function.name).toBe("read_file")
  })

  it("should merge multiple system messages into messages array", () => {
    const entry = TraceLogger.createTraceEntry({
      sessionID: "test-session",
      providerID: "openai",
      modelID: "gpt-4",
      agent: "default",
      system: ["System prompt 1", "System prompt 2", "System prompt 3"],
      messages: [
        { role: "user", content: "User message 1" },
        { role: "assistant", content: "Assistant response" },
        { role: "user", content: "User message 2" },
      ],
      tools: {},
      parameters: {},
    })

    // Verify system messages are at the beginning
    expect(entry.request.messages).toHaveLength(6)
    expect(entry.request.messages[0]).toEqual({ role: "system", content: "System prompt 1" })
    expect(entry.request.messages[1]).toEqual({ role: "system", content: "System prompt 2" })
    expect(entry.request.messages[2]).toEqual({ role: "system", content: "System prompt 3" })
    expect(entry.request.messages[3]).toEqual({ role: "user", content: "User message 1" })
    expect(entry.request.messages[4]).toEqual({ role: "assistant", content: "Assistant response" })
    expect(entry.request.messages[5]).toEqual({ role: "user", content: "User message 2" })
  })
})
