import { describe, expect, it } from "bun:test"
import type {
  Message,
  Part,
  UserMessage,
  AssistantMessage,
  TextPart,
  ToolPart,
  AgentPart,
  SubtaskPart,
} from "@opencode-ai/sdk/v2"

type TraceSource = "llm" | "tool" | "omo" | "unknown"
type TraceStatus = "pending" | "running" | "completed" | "error"
type TraceCategory = "user" | "opencode" | "llm" | "plugin"

interface CallTraceItem {
  id: string
  type: string
  source: TraceSource
  category: TraceCategory
  name: string
  component: string
  startTime: number
  endTime?: number
  duration?: number
  status: TraceStatus
  metadata?: Record<string, unknown>
  providerID?: string
  modelID?: string
  tokens?: { input: number; output: number }
  cost?: number
  toolName?: string
  input?: string
  output?: string
  agentName?: string
  description?: string
  sessionID?: string
  messageID?: string
}

interface CategorizedTraces {
  user: CallTraceItem[]
  opencode: CallTraceItem[]
  llm: CallTraceItem[]
  plugin: CallTraceItem[]
}

function createTraces(messages: Message[], partsMap: Record<string, Part[]>): CallTraceItem[] {
  const result: CallTraceItem[] = []

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    const parts = partsMap[msg.id] ?? []

    if (msg.role === "user") {
      const textParts = parts.filter((p) => p.type === "text") as TextPart[]
      for (const tp of textParts) {
        if (!tp.synthetic) {
          result.push({
            id: tp.id,
            type: "user",
            source: "unknown",
            category: "user",
            name: "User",
            component: "text",
            status: "completed",
            startTime: tp.time?.start ?? Date.now(),
            input: tp.text,
            messageID: msg.id,
            sessionID: tp.sessionID,
          })
        }
      }
    }

    if (msg.role === "assistant") {
      const textParts = parts.filter((p) => p.type === "text") as TextPart[]
      const assistantText = textParts.map((tp) => tp.text).join("")

      let userText = ""
      if (i > 0 && messages[i - 1].role === "user") {
        const prevParts = partsMap[messages[i - 1].id] ?? []
        const prevTextParts = prevParts.filter((p) => p.type === "text") as TextPart[]
        userText = prevTextParts
          .filter((tp) => !tp.synthetic)
          .map((tp) => tp.text)
          .join("")
      }

      const assistant = msg as AssistantMessage
      result.push({
        id: `llm-${assistant.id}`,
        type: "llm",
        source: "llm",
        category: "llm",
        name: `${assistant.providerID}/${assistant.modelID}`,
        component: "llm",
        status: "completed",
        startTime: assistant.time.created,
        endTime: assistant.time.completed,
        duration: assistant.time.completed ? assistant.time.completed - assistant.time.created : undefined,
        providerID: assistant.providerID,
        modelID: assistant.modelID,
        tokens: assistant.tokens ? { input: assistant.tokens.input, output: assistant.tokens.output } : undefined,
        cost: assistant.cost,
        input: userText,
        output: assistantText,
        sessionID: assistant.sessionID,
        messageID: assistant.id,
      })
    }

    for (const part of parts) {
      if (part.type === "tool") {
        const tool = part as ToolPart
        const state = tool.state
        const status: TraceStatus =
          state.status === "pending"
            ? "pending"
            : state.status === "running"
              ? "running"
              : state.status === "error"
                ? "error"
                : "completed"

        result.push({
          id: part.id,
          type: "tool",
          source: "tool",
          category: "opencode",
          name: tool.tool,
          component: "tool",
          toolName: tool.tool,
          status,
          startTime: "time" in state ? state.time.start : Date.now(),
          endTime: "time" in state && "end" in state.time ? state.time.end : undefined,
          duration: "time" in state && "end" in state.time ? state.time.end - state.time.start : undefined,
          input: "input" in state ? JSON.stringify(state.input) : undefined,
          output: "output" in state ? state.output : undefined,
          sessionID: part.sessionID,
          messageID: part.messageID,
        })
      }

      if (part.type === "agent") {
        const agent = part as AgentPart
        result.push({
          id: part.id,
          type: "omo",
          source: "omo",
          category: "plugin",
          name: agent.name,
          component: "agent",
          agentName: agent.name,
          status: "completed",
          startTime: Date.now(),
          sessionID: part.sessionID,
          messageID: part.messageID,
        })
      }

      if (part.type === "subtask") {
        const subtask = part as SubtaskPart
        result.push({
          id: part.id,
          type: "omo",
          source: "omo",
          category: "plugin",
          name: subtask.agent,
          component: "subtask",
          agentName: subtask.agent,
          description: subtask.description,
          status: "completed",
          startTime: Date.now(),
          input: subtask.prompt,
          sessionID: part.sessionID,
          messageID: part.messageID,
        })
      }
    }
  }

  return result
}

function categorize(traces: CallTraceItem[]): CategorizedTraces {
  return {
    user: traces.filter((t) => t.category === "user"),
    opencode: traces.filter((t) => t.category === "opencode"),
    llm: traces.filter((t) => t.category === "llm"),
    plugin: traces.filter((t) => t.category === "plugin"),
  }
}

describe("CallTraceBar trace generation", () => {
  describe("createTraces", () => {
    it("should create user trace from non-synthetic text parts", () => {
      const messages: UserMessage[] = [
        {
          id: "user-1",
          sessionID: "session-1",
          role: "user",
          time: { created: 1000 },
          agent: "user",
          model: { providerID: "test", modelID: "test" },
        },
      ]

      const partsMap: Record<string, Part[]> = {
        "user-1": [
          {
            id: "text-1",
            sessionID: "session-1",
            messageID: "user-1",
            type: "text",
            text: "Hello, how are you?",
            time: { start: 1000, end: 1001 },
          } as TextPart,
        ],
      }

      const traces = createTraces(messages, partsMap)

      expect(traces).toHaveLength(1)
      expect(traces[0].category).toBe("user")
      expect(traces[0].type).toBe("user")
      expect(traces[0].input).toBe("Hello, how are you?")
      expect(traces[0].name).toBe("User")
    })

    it("should skip synthetic text parts in user messages", () => {
      const messages: UserMessage[] = [
        {
          id: "user-1",
          sessionID: "session-1",
          role: "user",
          time: { created: 1000 },
          agent: "user",
          model: { providerID: "test", modelID: "test" },
        },
      ]

      const partsMap: Record<string, Part[]> = {
        "user-1": [
          {
            id: "text-1",
            sessionID: "session-1",
            messageID: "user-1",
            type: "text",
            text: "Synthetic content",
            synthetic: true,
          } as TextPart,
        ],
      }

      const traces = createTraces(messages, partsMap)

      expect(traces).toHaveLength(0)
    })

    it("should create LLM trace from assistant message", () => {
      const messages: AssistantMessage[] = [
        {
          id: "assistant-1",
          sessionID: "session-1",
          parentID: "user-1",
          role: "assistant",
          providerID: "anthropic",
          modelID: "claude-3-5-sonnet",
          mode: "build",
          agent: "build",
          path: { cwd: "/", root: "/" },
          time: { created: 2000, completed: 3000 },
          tokens: {
            input: 100,
            output: 200,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          cost: 0.002,
          finish: "stop",
        },
      ]

      const partsMap: Record<string, Part[]> = {
        "assistant-1": [
          {
            id: "text-2",
            sessionID: "session-1",
            messageID: "assistant-1",
            type: "text",
            text: "I'm doing well, thank you!",
          } as TextPart,
        ],
      }

      const traces = createTraces(messages, partsMap)

      expect(traces).toHaveLength(1)
      expect(traces[0].category).toBe("llm")
      expect(traces[0].type).toBe("llm")
      expect(traces[0].name).toBe("anthropic/claude-3-5-sonnet")
      expect(traces[0].tokens).toEqual({ input: 100, output: 200 })
      expect(traces[0].cost).toBe(0.002)
      expect(traces[0].output).toBe("I'm doing well, thank you!")
    })

    it("should include user text as LLM input when previous message is user", () => {
      const messages: (UserMessage | AssistantMessage)[] = [
        {
          id: "user-1",
          sessionID: "session-1",
          role: "user",
          time: { created: 1000 },
          agent: "user",
          model: { providerID: "test", modelID: "test" },
        },
        {
          id: "assistant-1",
          sessionID: "session-1",
          parentID: "user-1",
          role: "assistant",
          providerID: "anthropic",
          modelID: "claude-3-5-sonnet",
          mode: "build",
          agent: "build",
          path: { cwd: "/", root: "/" },
          time: { created: 2000, completed: 3000 },
          tokens: { input: 100, output: 200, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0.002,
          finish: "stop",
        },
      ]

      const partsMap: Record<string, Part[]> = {
        "user-1": [
          {
            id: "text-1",
            sessionID: "session-1",
            messageID: "user-1",
            type: "text",
            text: "What's the weather?",
          } as TextPart,
        ],
        "assistant-1": [
          {
            id: "text-2",
            sessionID: "session-1",
            messageID: "assistant-1",
            type: "text",
            text: "I don't have access to weather data.",
          } as TextPart,
        ],
      }

      const traces = createTraces(messages, partsMap)

      const llmTrace = traces.find((t) => t.category === "llm")
      expect(llmTrace).toBeDefined()
      expect(llmTrace!.input).toBe("What's the weather?")
      expect(llmTrace!.output).toBe("I don't have access to weather data.")
    })

    it("should create tool traces with opencode category", () => {
      const messages: UserMessage[] = [
        {
          id: "user-1",
          sessionID: "session-1",
          role: "user",
          time: { created: 1000 },
          agent: "user",
          model: { providerID: "test", modelID: "test" },
        },
      ]

      const partsMap: Record<string, Part[]> = {
        "user-1": [],
        "assistant-1": [
          {
            id: "tool-1",
            sessionID: "session-1",
            messageID: "assistant-1",
            type: "tool",
            callID: "call-1",
            tool: "read",
            state: {
              status: "completed",
              input: { path: "/test.txt" },
              output: "file content",
              title: "Read file",
              metadata: {},
              time: { start: 2000, end: 2500 },
            },
          } as ToolPart,
        ],
      }

      const messagesWithAssistant: Message[] = [
        ...messages,
        {
          id: "assistant-1",
          sessionID: "session-1",
          parentID: "user-1",
          role: "assistant",
          providerID: "anthropic",
          modelID: "claude-3-5-sonnet",
          mode: "build",
          agent: "build",
          path: { cwd: "/", root: "/" },
          time: { created: 1500, completed: 3000 },
          tokens: { input: 50, output: 100, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0.001,
          finish: "stop",
        } as AssistantMessage,
      ]

      const traces = createTraces(messagesWithAssistant, partsMap)

      const toolTraces = traces.filter((t) => t.category === "opencode")
      expect(toolTraces).toHaveLength(1)
      expect(toolTraces[0].name).toBe("read")
      expect(toolTraces[0].status).toBe("completed")
      expect(toolTraces[0].duration).toBe(500)
    })

    it("should handle tool with pending status", () => {
      const messages: AssistantMessage[] = [
        {
          id: "assistant-1",
          sessionID: "session-1",
          parentID: "user-1",
          role: "assistant",
          providerID: "anthropic",
          modelID: "claude-3-5-sonnet",
          mode: "build",
          agent: "build",
          path: { cwd: "/", root: "/" },
          time: { created: 1000 },
          tokens: { input: 50, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0,
          finish: "stop",
        },
      ]

      const partsMap: Record<string, Part[]> = {
        "assistant-1": [
          {
            id: "tool-1",
            sessionID: "session-1",
            messageID: "assistant-1",
            type: "tool",
            callID: "call-1",
            tool: "write",
            state: {
              status: "pending",
              input: { path: "/output.txt" },
              raw: "",
            },
          } as ToolPart,
        ],
      }

      const traces = createTraces(messages, partsMap)

      const toolTrace = traces.find((t) => t.type === "tool")
      expect(toolTrace).toBeDefined()
      expect(toolTrace!.status).toBe("pending")
      expect(toolTrace!.endTime).toBeUndefined()
    })

    it("should handle tool with running status", () => {
      const messages: AssistantMessage[] = [
        {
          id: "assistant-1",
          sessionID: "session-1",
          parentID: "user-1",
          role: "assistant",
          providerID: "anthropic",
          modelID: "claude-3-5-sonnet",
          mode: "build",
          agent: "build",
          path: { cwd: "/", root: "/" },
          time: { created: 1000 },
          tokens: { input: 50, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0,
          finish: "stop",
        },
      ]

      const partsMap: Record<string, Part[]> = {
        "assistant-1": [
          {
            id: "tool-1",
            sessionID: "session-1",
            messageID: "assistant-1",
            type: "tool",
            callID: "call-1",
            tool: "bash",
            state: {
              status: "running",
              input: { command: "ls -la" },
              title: "Running bash",
              time: { start: 1500 },
            },
          } as ToolPart,
        ],
      }

      const traces = createTraces(messages, partsMap)

      const toolTrace = traces.find((t) => t.type === "tool")
      expect(toolTrace).toBeDefined()
      expect(toolTrace!.status).toBe("running")
      expect(toolTrace!.endTime).toBeUndefined()
    })

    it("should handle tool with error status", () => {
      const messages: AssistantMessage[] = [
        {
          id: "assistant-1",
          sessionID: "session-1",
          parentID: "user-1",
          role: "assistant",
          providerID: "anthropic",
          modelID: "claude-3-5-sonnet",
          mode: "build",
          agent: "build",
          path: { cwd: "/", root: "/" },
          time: { created: 1000 },
          tokens: { input: 50, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0,
          finish: "stop",
        },
      ]

      const partsMap: Record<string, Part[]> = {
        "assistant-1": [
          {
            id: "tool-1",
            sessionID: "session-1",
            messageID: "assistant-1",
            type: "tool",
            callID: "call-1",
            tool: "glob",
            state: {
              status: "error",
              input: { pattern: "*.missing" },
              error: "Pattern not found",
              time: { start: 1500, end: 1550 },
            },
          } as ToolPart,
        ],
      }

      const traces = createTraces(messages, partsMap)

      const toolTrace = traces.find((t) => t.type === "tool")
      expect(toolTrace).toBeDefined()
      expect(toolTrace!.status).toBe("error")
      expect(toolTrace!.duration).toBe(50)
    })

    it("should create agent trace with plugin category", () => {
      const messages: AssistantMessage[] = [
        {
          id: "assistant-1",
          sessionID: "session-1",
          parentID: "user-1",
          role: "assistant",
          providerID: "anthropic",
          modelID: "claude-3-5-sonnet",
          mode: "build",
          agent: "build",
          path: { cwd: "/", root: "/" },
          time: { created: 1000 },
          tokens: { input: 50, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0,
          finish: "stop",
        },
      ]

      const partsMap: Record<string, Part[]> = {
        "assistant-1": [
          {
            id: "agent-1",
            sessionID: "session-1",
            messageID: "assistant-1",
            type: "agent",
            name: "general",
          } as AgentPart,
        ],
      }

      const traces = createTraces(messages, partsMap)

      const agentTrace = traces.find((t) => t.type === "omo")
      expect(agentTrace).toBeDefined()
      expect(agentTrace!.category).toBe("plugin")
      expect(agentTrace!.name).toBe("general")
      expect(agentTrace!.agentName).toBe("general")
    })

    it("should create subtask trace with plugin category", () => {
      const messages: AssistantMessage[] = [
        {
          id: "assistant-1",
          sessionID: "session-1",
          parentID: "user-1",
          role: "assistant",
          providerID: "anthropic",
          modelID: "claude-3-5-sonnet",
          mode: "build",
          agent: "build",
          path: { cwd: "/", root: "/" },
          time: { created: 1000 },
          tokens: { input: 50, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0,
          finish: "stop",
        },
      ]

      const partsMap: Record<string, Part[]> = {
        "assistant-1": [
          {
            id: "subtask-1",
            sessionID: "session-1",
            messageID: "assistant-1",
            type: "subtask",
            prompt: "Search for TypeScript files",
            description: "Finding all .ts files",
            agent: "build",
          } as SubtaskPart,
        ],
      }

      const traces = createTraces(messages, partsMap)

      const subtaskTrace = traces.find((t) => t.id === "subtask-1")
      expect(subtaskTrace).toBeDefined()
      expect(subtaskTrace!.category).toBe("plugin")
      expect(subtaskTrace!.name).toBe("build")
      expect(subtaskTrace!.description).toBe("Finding all .ts files")
      expect(subtaskTrace!.input).toBe("Search for TypeScript files")
    })

    it("should handle empty messages array", () => {
      const traces = createTraces([], {})
      expect(traces).toHaveLength(0)
    })

    it("should handle message with no parts", () => {
      const messages: UserMessage[] = [
        {
          id: "user-1",
          sessionID: "session-1",
          role: "user",
          time: { created: 1000 },
          agent: "user",
          model: { providerID: "test", modelID: "test" },
        },
      ]

      const traces = createTraces(messages, {})

      expect(traces).toHaveLength(0)
    })

    it("should handle multiple text parts in user message", () => {
      const messages: UserMessage[] = [
        {
          id: "user-1",
          sessionID: "session-1",
          role: "user",
          time: { created: 1000 },
          agent: "user",
          model: { providerID: "test", modelID: "test" },
        },
      ]

      const partsMap: Record<string, Part[]> = {
        "user-1": [
          {
            id: "text-1",
            sessionID: "session-1",
            messageID: "user-1",
            type: "text",
            text: "First part",
          } as TextPart,
          {
            id: "text-2",
            sessionID: "session-1",
            messageID: "user-1",
            type: "text",
            text: "Second part",
          } as TextPart,
        ],
      }

      const traces = createTraces(messages, partsMap)

      // Both non-synthetic text parts should create user traces
      expect(traces).toHaveLength(2)
      expect(traces.every((t) => t.category === "user")).toBe(true)
    })

    it("should handle multiple tool calls in assistant message", () => {
      const messages: AssistantMessage[] = [
        {
          id: "assistant-1",
          sessionID: "session-1",
          parentID: "user-1",
          role: "assistant",
          providerID: "anthropic",
          modelID: "claude-3-5-sonnet",
          mode: "build",
          agent: "build",
          path: { cwd: "/", root: "/" },
          time: { created: 1000, completed: 2000 },
          tokens: { input: 50, output: 100, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0.001,
          finish: "stop",
        },
      ]

      const partsMap: Record<string, Part[]> = {
        "assistant-1": [
          {
            id: "tool-1",
            sessionID: "session-1",
            messageID: "assistant-1",
            type: "tool",
            callID: "call-1",
            tool: "read",
            state: {
              status: "completed",
              input: { path: "/file1.txt" },
              output: "content1",
              title: "Read file1",
              metadata: {},
              time: { start: 1100, end: 1200 },
            },
          } as ToolPart,
          {
            id: "tool-2",
            sessionID: "session-1",
            messageID: "assistant-1",
            type: "tool",
            callID: "call-2",
            tool: "write",
            state: {
              status: "completed",
              input: { path: "/file2.txt" },
              output: "written",
              title: "Write file2",
              metadata: {},
              time: { start: 1300, end: 1400 },
            },
          } as ToolPart,
        ],
      }

      const traces = createTraces(messages, partsMap)

      const toolTraces = traces.filter((t) => t.category === "opencode")
      expect(toolTraces).toHaveLength(2)
      expect(toolTraces[0].name).toBe("read")
      expect(toolTraces[1].name).toBe("write")
    })

    it("should handle assistant message without completion time", () => {
      const messages: AssistantMessage[] = [
        {
          id: "assistant-1",
          sessionID: "session-1",
          parentID: "user-1",
          role: "assistant",
          providerID: "anthropic",
          modelID: "claude-3-5-sonnet",
          mode: "build",
          agent: "build",
          path: { cwd: "/", root: "/" },
          time: { created: 1000 }, // No completion time
          tokens: { input: 50, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0,
          finish: "stop",
        },
      ]

      const traces = createTraces(messages, {})

      expect(traces).toHaveLength(1)
      expect(traces[0].endTime).toBeUndefined()
      expect(traces[0].duration).toBeUndefined()
    })
  })

  describe("categorize", () => {
    it("should correctly categorize traces by category", () => {
      const traces: CallTraceItem[] = [
        {
          id: "1",
          type: "user",
          source: "unknown",
          category: "user",
          name: "User",
          component: "text",
          status: "completed",
          startTime: 1000,
        },
        {
          id: "2",
          type: "tool",
          source: "tool",
          category: "opencode",
          name: "read",
          component: "tool",
          status: "completed",
          startTime: 2000,
        },
        {
          id: "3",
          type: "llm",
          source: "llm",
          category: "llm",
          name: "anthropic/claude",
          component: "llm",
          status: "completed",
          startTime: 3000,
        },
        {
          id: "4",
          type: "omo",
          source: "omo",
          category: "plugin",
          name: "build",
          component: "agent",
          status: "completed",
          startTime: 4000,
        },
      ]

      const categorized = categorize(traces)

      expect(categorized.user).toHaveLength(1)
      expect(categorized.opencode).toHaveLength(1)
      expect(categorized.llm).toHaveLength(1)
      expect(categorized.plugin).toHaveLength(1)

      expect(categorized.user[0].id).toBe("1")
      expect(categorized.opencode[0].id).toBe("2")
      expect(categorized.llm[0].id).toBe("3")
      expect(categorized.plugin[0].id).toBe("4")
    })

    it("should return empty arrays for empty traces", () => {
      const categorized = categorize([])

      expect(categorized.user).toHaveLength(0)
      expect(categorized.opencode).toHaveLength(0)
      expect(categorized.llm).toHaveLength(0)
      expect(categorized.plugin).toHaveLength(0)
    })

    it("should handle traces with only one category", () => {
      const traces: CallTraceItem[] = [
        {
          id: "1",
          type: "tool",
          source: "tool",
          category: "opencode",
          name: "read",
          component: "tool",
          status: "completed",
          startTime: 1000,
        },
        {
          id: "2",
          type: "tool",
          source: "tool",
          category: "opencode",
          name: "write",
          component: "tool",
          status: "completed",
          startTime: 2000,
        },
      ]

      const categorized = categorize(traces)

      expect(categorized.user).toHaveLength(0)
      expect(categorized.opencode).toHaveLength(2)
      expect(categorized.llm).toHaveLength(0)
      expect(categorized.plugin).toHaveLength(0)
    })

    it("should preserve trace order within categories", () => {
      const traces: CallTraceItem[] = [
        {
          id: "tool-1",
          type: "tool",
          source: "tool",
          category: "opencode",
          name: "read",
          component: "tool",
          status: "completed",
          startTime: 1000,
        },
        {
          id: "llm-1",
          type: "llm",
          source: "llm",
          category: "llm",
          name: "anthropic/claude",
          component: "llm",
          status: "completed",
          startTime: 2000,
        },
        {
          id: "tool-2",
          type: "tool",
          source: "tool",
          category: "opencode",
          name: "write",
          component: "tool",
          status: "completed",
          startTime: 3000,
        },
      ]

      const categorized = categorize(traces)

      expect(categorized.opencode[0].id).toBe("tool-1")
      expect(categorized.opencode[1].id).toBe("tool-2")
    })
  })

  describe("complex scenarios", () => {
    it("should handle full conversation with mixed trace types", () => {
      const messages: (UserMessage | AssistantMessage)[] = [
        {
          id: "user-1",
          sessionID: "session-1",
          role: "user",
          time: { created: 1000 },
          agent: "user",
          model: { providerID: "test", modelID: "test" },
        },
        {
          id: "assistant-1",
          sessionID: "session-1",
          parentID: "user-1",
          role: "assistant",
          providerID: "anthropic",
          modelID: "claude-3-5-sonnet",
          mode: "build",
          agent: "build",
          path: { cwd: "/", root: "/" },
          time: { created: 1500, completed: 2500 },
          tokens: { input: 100, output: 200, reasoning: 0, cache: { read: 10, write: 5 } },
          cost: 0.002,
          finish: "stop",
        },
        {
          id: "user-2",
          sessionID: "session-1",
          role: "user",
          time: { created: 3000 },
          agent: "user",
          model: { providerID: "test", modelID: "test" },
        },
        {
          id: "assistant-2",
          sessionID: "session-1",
          parentID: "user-2",
          role: "assistant",
          providerID: "anthropic",
          modelID: "claude-3-5-sonnet",
          mode: "build",
          agent: "build",
          path: { cwd: "/", root: "/" },
          time: { created: 3500, completed: 4500 },
          tokens: { input: 150, output: 250, reasoning: 0, cache: { read: 15, write: 10 } },
          cost: 0.003,
          finish: "stop",
        },
      ]

      const partsMap: Record<string, Part[]> = {
        "user-1": [
          {
            id: "text-1",
            sessionID: "session-1",
            messageID: "user-1",
            type: "text",
            text: "Read file.txt",
          } as TextPart,
        ],
        "assistant-1": [
          {
            id: "tool-1",
            sessionID: "session-1",
            messageID: "assistant-1",
            type: "tool",
            callID: "call-1",
            tool: "read",
            state: {
              status: "completed",
              input: { path: "/file.txt" },
              output: "Hello World",
              title: "Read file",
              metadata: {},
              time: { start: 1600, end: 1800 },
            },
          } as ToolPart,
          {
            id: "text-2",
            sessionID: "session-1",
            messageID: "assistant-1",
            type: "text",
            text: "File content: Hello World",
          } as TextPart,
        ],
        "user-2": [
          {
            id: "text-3",
            sessionID: "session-1",
            messageID: "user-2",
            type: "text",
            text: "Now write to output.txt",
          } as TextPart,
        ],
        "assistant-2": [
          {
            id: "agent-1",
            sessionID: "session-1",
            messageID: "assistant-2",
            type: "agent",
            name: "build",
          } as AgentPart,
          {
            id: "tool-2",
            sessionID: "session-1",
            messageID: "assistant-2",
            type: "tool",
            callID: "call-2",
            tool: "write",
            state: {
              status: "completed",
              input: { path: "/output.txt", content: "Written content" },
              output: "success",
              title: "Write file",
              metadata: {},
              time: { start: 3600, end: 3800 },
            },
          } as ToolPart,
          {
            id: "text-4",
            sessionID: "session-1",
            messageID: "assistant-2",
            type: "text",
            text: "Done!",
          } as TextPart,
        ],
      }

      const traces = createTraces(messages, partsMap)
      const categorized = categorize(traces)

      // Check user traces
      expect(categorized.user).toHaveLength(2)
      expect(categorized.user[0].input).toBe("Read file.txt")
      expect(categorized.user[1].input).toBe("Now write to output.txt")

      // Check LLM traces
      expect(categorized.llm).toHaveLength(2)
      expect(categorized.llm[0].input).toBe("Read file.txt")
      expect(categorized.llm[0].output).toBe("File content: Hello World")
      expect(categorized.llm[1].input).toBe("Now write to output.txt")

      // Check opencode (tool) traces
      expect(categorized.opencode).toHaveLength(2)
      expect(categorized.opencode[0].name).toBe("read")
      expect(categorized.opencode[1].name).toBe("write")

      // Check plugin traces
      expect(categorized.plugin).toHaveLength(1)
      expect(categorized.plugin[0].name).toBe("build")
    })

    it("should handle assistant message without preceding user message", () => {
      const messages: AssistantMessage[] = [
        {
          id: "assistant-1",
          sessionID: "session-1",
          parentID: "user-1",
          role: "assistant",
          providerID: "anthropic",
          modelID: "claude-3-5-sonnet",
          mode: "build",
          agent: "build",
          path: { cwd: "/", root: "/" },
          time: { created: 1000, completed: 2000 },
          tokens: { input: 50, output: 100, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0.001,
          finish: "stop",
        },
      ]

      const traces = createTraces(messages, {})

      expect(traces).toHaveLength(1)
      expect(traces[0].input).toBe("") // No preceding user message
    })

    it("should filter synthetic text from LLM input", () => {
      const messages: (UserMessage | AssistantMessage)[] = [
        {
          id: "user-1",
          sessionID: "session-1",
          role: "user",
          time: { created: 1000 },
          agent: "user",
          model: { providerID: "test", modelID: "test" },
        },
        {
          id: "assistant-1",
          sessionID: "session-1",
          parentID: "user-1",
          role: "assistant",
          providerID: "anthropic",
          modelID: "claude-3-5-sonnet",
          mode: "build",
          agent: "build",
          path: { cwd: "/", root: "/" },
          time: { created: 1500, completed: 2500 },
          tokens: { input: 100, output: 200, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0.002,
          finish: "stop",
        },
      ]

      const partsMap: Record<string, Part[]> = {
        "user-1": [
          {
            id: "text-1",
            sessionID: "session-1",
            messageID: "user-1",
            type: "text",
            text: "Real user input",
          } as TextPart,
          {
            id: "text-synth",
            sessionID: "session-1",
            messageID: "user-1",
            type: "text",
            text: "Synthetic context",
            synthetic: true,
          } as TextPart,
        ],
        "assistant-1": [
          {
            id: "text-2",
            sessionID: "session-1",
            messageID: "assistant-1",
            type: "text",
            text: "Response",
          } as TextPart,
        ],
      }

      const traces = createTraces(messages, partsMap)

      const llmTrace = traces.find((t) => t.category === "llm")
      expect(llmTrace).toBeDefined()
      expect(llmTrace!.input).toBe("Real user input") // Synthetic filtered out
    })
  })
})
