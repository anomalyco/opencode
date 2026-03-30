import { describe, expect, it } from "bun:test"
import type { ToolPart, AgentPart, SubtaskPart, UserMessage, AssistantMessage } from "@opencode-ai/sdk/v2"
import { partToTrace, messageToLLMTrace } from "@/cli/cmd/tui/context/call-trace"

describe("partToTrace", () => {
  it("should convert completed ToolPart to CallTraceItem", () => {
    const toolPart: ToolPart = {
      id: "tool-1",
      sessionID: "session-1",
      messageID: "msg-1",
      type: "tool",
      callID: "call-1",
      tool: "read",
      state: {
        status: "completed",
        input: { path: "/test/file.txt" },
        output: "file content",
        title: "Read file",
        metadata: {},
        time: {
          start: 1000,
          end: 1500,
        },
      },
    }

    const trace = partToTrace(toolPart)

    expect(trace).not.toBeNull()
    expect(trace?.id).toBe("tool-1")
    expect(trace?.type).toBe("tool")
    expect(trace?.source).toBe("tool")
    expect(trace?.category).toBe("opencode")
    expect(trace?.name).toBe("read")
    expect(trace?.toolName).toBe("read")
    expect(trace?.status).toBe("completed")
    expect(trace?.startTime).toBe(1000)
    expect(trace?.endTime).toBe(1500)
    expect(trace?.duration).toBe(500)
    expect(trace?.input).toBe('{"path":"/test/file.txt"}')
    expect(trace?.output).toBe("file content")
    expect(trace?.sessionID).toBe("session-1")
    expect(trace?.messageID).toBe("msg-1")
  })

  it("should handle ToolPart with pending status", () => {
    const toolPart: ToolPart = {
      id: "tool-2",
      sessionID: "session-1",
      messageID: "msg-1",
      type: "tool",
      callID: "call-2",
      tool: "write",
      state: {
        status: "pending",
        input: { path: "/test/output.txt" },
        raw: "",
      },
    }

    const trace = partToTrace(toolPart)

    expect(trace).not.toBeNull()
    expect(trace?.status).toBe("pending")
    expect(trace?.startTime).toBeTypeOf("number")
    expect(trace?.endTime).toBeUndefined()
    expect(trace?.duration).toBeUndefined()
  })

  it("should handle ToolPart with running status", () => {
    const toolPart: ToolPart = {
      id: "tool-3",
      sessionID: "session-1",
      messageID: "msg-1",
      type: "tool",
      callID: "call-3",
      tool: "bash",
      state: {
        status: "running",
        input: { command: "ls -la" },
        title: "Running bash",
        time: {
          start: 2000,
        },
      },
    }

    const trace = partToTrace(toolPart)

    expect(trace).not.toBeNull()
    expect(trace?.status).toBe("running")
    expect(trace?.startTime).toBe(2000)
    expect(trace?.endTime).toBeUndefined()
    expect(trace?.duration).toBeUndefined()
  })

  it("should handle ToolPart with error status", () => {
    const toolPart: ToolPart = {
      id: "tool-4",
      sessionID: "session-1",
      messageID: "msg-1",
      type: "tool",
      callID: "call-4",
      tool: "glob",
      state: {
        status: "error",
        input: { pattern: "*.ts" },
        error: "Pattern not found",
        time: {
          start: 3000,
          end: 3100,
        },
      },
    }

    const trace = partToTrace(toolPart)

    expect(trace).not.toBeNull()
    expect(trace?.status).toBe("error")
    expect(trace?.startTime).toBe(3000)
    expect(trace?.endTime).toBe(3100)
    expect(trace?.duration).toBe(100)
  })

  it("should convert AgentPart to OMO trace", () => {
    const agentPart: AgentPart = {
      id: "agent-1",
      sessionID: "session-1",
      messageID: "msg-1",
      type: "agent",
      name: "general",
    }

    const trace = partToTrace(agentPart)

    expect(trace).not.toBeNull()
    expect(trace?.id).toBe("agent-1")
    expect(trace?.type).toBe("omo")
    expect(trace?.source).toBe("omo")
    expect(trace?.category).toBe("plugin")
    expect(trace?.name).toBe("general")
    expect(trace?.agentName).toBe("general")
    expect(trace?.status).toBe("completed")
  })

  it("should convert SubtaskPart to OMO trace", () => {
    const subtaskPart: SubtaskPart = {
      id: "subtask-1",
      sessionID: "session-1",
      messageID: "msg-1",
      type: "subtask",
      prompt: "Search for files",
      description: "Finding all TypeScript files",
      agent: "build",
    }

    const trace = partToTrace(subtaskPart)

    expect(trace).not.toBeNull()
    expect(trace?.id).toBe("subtask-1")
    expect(trace?.type).toBe("omo")
    expect(trace?.source).toBe("omo")
    expect(trace?.category).toBe("plugin")
    expect(trace?.name).toBe("build")
    expect(trace?.agentName).toBe("build")
    expect(trace?.description).toBe("Finding all TypeScript files")
    expect(trace?.input).toBe("Search for files")
    expect(trace?.status).toBe("completed")
  })

  it("should return null for unsupported part types", () => {
    const textPart = {
      id: "text-1",
      sessionID: "session-1",
      messageID: "msg-1",
      type: "text",
      text: "Hello world",
    }

    const trace = partToTrace(textPart as any)

    expect(trace).toBeNull()
  })
})

describe("messageToLLMTrace", () => {
  it("should convert AssistantMessage to LLM trace", () => {
    const assistantMsg: AssistantMessage = {
      id: "assistant-1",
      sessionID: "session-1",
      parentID: "user-1",
      role: "assistant",
      providerID: "anthropic",
      modelID: "claude-3-5-sonnet-20241022",
      mode: "build",
      agent: "build",
      path: { cwd: "/", root: "/" },
      time: {
        created: 1000,
        completed: 2000,
      },
      tokens: {
        input: 100,
        output: 200,
        reasoning: 0,
        cache: { read: 10, write: 5 },
      },
      cost: 0.0015,
      finish: "stop",
    }

    const trace = messageToLLMTrace(assistantMsg, "Hello, how are you?", "I'm doing well, thank you!")

    expect(trace).not.toBeNull()
    expect(trace?.id).toBe("llm-assistant-1")
    expect(trace?.type).toBe("llm")
    expect(trace?.source).toBe("llm")
    expect(trace?.category).toBe("llm")
    expect(trace?.name).toBe("anthropic/claude-3-5-sonnet-20241022")
    expect(trace?.status).toBe("completed")
    expect(trace?.startTime).toBe(1000)
    expect(trace?.endTime).toBe(2000)
    expect(trace?.duration).toBe(1000)
    expect(trace?.providerID).toBe("anthropic")
    expect(trace?.modelID).toBe("claude-3-5-sonnet-20241022")
    expect(trace?.tokens).toEqual({ input: 100, output: 200 })
    expect(trace?.cost).toBe(0.0015)
    expect(trace?.input).toBe("Hello, how are you?")
    expect(trace?.output).toBe("I'm doing well, thank you!")
  })

  it("should handle AssistantMessage without completion time", () => {
    const assistantMsg: AssistantMessage = {
      id: "assistant-2",
      sessionID: "session-1",
      parentID: "user-1",
      role: "assistant",
      providerID: "openai",
      modelID: "gpt-4",
      mode: "build",
      agent: "build",
      path: { cwd: "/", root: "/" },
      time: {
        created: 1000,
      },
      tokens: {
        input: 50,
        output: 75,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      cost: 0.001,
      finish: "stop",
    }

    const trace = messageToLLMTrace(assistantMsg)

    expect(trace).not.toBeNull()
    expect(trace?.endTime).toBeUndefined()
    expect(trace?.duration).toBeUndefined()
    expect(trace?.input).toBeUndefined()
    expect(trace?.output).toBeUndefined()
  })

  it("should return null for non-assistant messages", () => {
    const userMsg: UserMessage = {
      id: "user-1",
      sessionID: "session-1",
      role: "user",
      time: {
        created: 1000,
      },
      agent: "user",
      model: { providerID: "test", modelID: "test" },
    }

    const trace = messageToLLMTrace(userMsg)

    expect(trace).toBeNull()
  })

  it("should handle missing tokens and cost", () => {
    const assistantMsg: AssistantMessage = {
      id: "assistant-3",
      sessionID: "session-1",
      parentID: "user-1",
      role: "assistant",
      providerID: "ollama",
      modelID: "llama2",
      mode: "build",
      agent: "build",
      path: { cwd: "/", root: "/" },
      time: {
        created: 1000,
        completed: 1500,
      },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      finish: "stop",
    } as AssistantMessage

    const trace = messageToLLMTrace(assistantMsg)

    expect(trace).not.toBeNull()
    expect(trace?.tokens).toEqual({ input: 0, output: 0 })
    expect(trace?.cost).toBe(0)
  })
})
