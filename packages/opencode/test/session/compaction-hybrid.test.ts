import { describe, expect, test, mock } from "bun:test"
import { CompactionSchema } from "../../src/session/compaction/schema"
import { DeterministicExtractor } from "../../src/session/compaction/extractors"
import { LLMExtractor } from "../../src/session/compaction/llm-extractor"
import type { MessageV2 } from "../../src/session/message-v2"

describe("compaction/schema", () => {
  describe("CompactionTemplate", () => {
    test("validates a complete valid template", () => {
      const validTemplate = {
        version: "1.0" as const,
        timestamp: Date.now(),
        artifacts: {
          files_read: ["/src/file1.ts", "/src/file2.ts"],
          files_modified: [
            { path: "/src/main.ts", change_summary: "Added new function" },
          ],
          files_created: ["/src/new-file.ts"],
        },
        tool_calls: [
          { tool: "read", summary: "3x (3/3 successful)", success: true },
          { tool: "edit", summary: "2x (2/2 successful)", success: true },
        ],
        errors: [
          { message: "TypeError: x is undefined", resolved: true, resolution: "Fixed null check" },
        ],
        session_intent: "Implement a new feature for user authentication",
        current_state: "Authentication module is 80% complete",
        decisions: [
          { decision: "Use JWT tokens", rationale: "Better for stateless auth" },
        ],
        pending_tasks: ["Add logout endpoint", "Write tests"],
        key_context: "Using express.js backend with PostgreSQL",
        metrics: {
          original_tokens: 50000,
          compacted_tokens: 3000,
          compression_ratio: 0.94,
        },
      }

      const result = CompactionSchema.CompactionTemplate.safeParse(validTemplate)
      expect(result.success).toBe(true)
    })

    test("rejects invalid version", () => {
      const invalidTemplate = {
        version: "2.0",
        timestamp: Date.now(),
        artifacts: { files_read: [], files_modified: [], files_created: [] },
        tool_calls: [],
        errors: [],
        session_intent: "",
        current_state: "",
        decisions: [],
        pending_tasks: [],
        key_context: "",
        metrics: { original_tokens: 0, compacted_tokens: 0, compression_ratio: 0 },
      }

      const result = CompactionSchema.CompactionTemplate.safeParse(invalidTemplate)
      expect(result.success).toBe(false)
    })

    test("requires all mandatory fields", () => {
      const incomplete = {
        version: "1.0",
        timestamp: Date.now(),
      }

      const result = CompactionSchema.CompactionTemplate.safeParse(incomplete)
      expect(result.success).toBe(false)
    })

    test("accepts optional agent_context", () => {
      const templateWithAgent = {
        version: "1.0" as const,
        timestamp: Date.now(),
        artifacts: { files_read: [], files_modified: [], files_created: [] },
        tool_calls: [],
        errors: [],
        session_intent: "Test intent",
        current_state: "Test state",
        decisions: [],
        pending_tasks: [],
        key_context: "Test context",
        agent_context: {
          agent_name: "build",
          agent_role: "Primary development agent",
          constraints: ["No external API calls", "Must use TypeScript"],
        },
        metrics: { original_tokens: 1000, compacted_tokens: 100, compression_ratio: 0.9 },
      }

      const result = CompactionSchema.CompactionTemplate.safeParse(templateWithAgent)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.agent_context?.agent_name).toBe("build")
      }
    })
  })

  describe("FileModification", () => {
    test("validates file modification with change summary", () => {
      const mod = { path: "/src/file.ts", change_summary: "Added function foo" }
      const result = CompactionSchema.FileModification.safeParse(mod)
      expect(result.success).toBe(true)
    })

    test("allows optional change_summary", () => {
      const mod = { path: "/src/file.ts" }
      const result = CompactionSchema.FileModification.safeParse(mod)
      expect(result.success).toBe(true)
    })
  })

  describe("ToolCallSummary", () => {
    test("validates tool call summary", () => {
      const call = { tool: "bash", summary: "5x (4/5 successful)", success: false }
      const result = CompactionSchema.ToolCallSummary.safeParse(call)
      expect(result.success).toBe(true)
    })
  })

  describe("ErrorInfo", () => {
    test("validates resolved error with resolution", () => {
      const err = {
        message: "Connection timeout",
        resolved: true,
        resolution: "Increased timeout to 30s",
      }
      const result = CompactionSchema.ErrorInfo.safeParse(err)
      expect(result.success).toBe(true)
    })

    test("validates unresolved error", () => {
      const err = {
        message: "Memory leak detected",
        resolved: false,
      }
      const result = CompactionSchema.ErrorInfo.safeParse(err)
      expect(result.success).toBe(true)
    })
  })

  describe("Decision", () => {
    test("validates decision with rationale", () => {
      const decision = {
        decision: "Use React Query for data fetching",
        rationale: "Better caching and optimistic updates",
      }
      const result = CompactionSchema.Decision.safeParse(decision)
      expect(result.success).toBe(true)
    })
  })

  describe("LLMExtractionOutput", () => {
    test("validates LLM extraction output", () => {
      const output = {
        session_intent: "Build a CLI tool",
        current_state: "Core functionality implemented",
        decisions: [{ decision: "Use Commander.js", rationale: "Popular and well-documented" }],
        pending_tasks: ["Add help command", "Write README"],
        key_context: "Node.js project with TypeScript",
      }
      const result = CompactionSchema.LLMExtractionOutput.safeParse(output)
      expect(result.success).toBe(true)
    })
  })
})

// =============================================================================
// DETERMINISTIC EXTRACTOR TESTS
// =============================================================================

describe("compaction/extractors", () => {
  // Helper to create mock messages
  function createMockMessage(
    role: "user" | "assistant",
    parts: MessageV2.Part[]
  ): MessageV2.WithParts {
    return {
      info: {
        id: "msg_" + Math.random().toString(36).slice(2),
        sessionID: "session_test",
        role,
        time: { created: Date.now() },
        ...(role === "user"
          ? { agent: "build", model: { providerID: "test", modelID: "test" } }
          : {
              parentID: "parent",
              modelID: "test",
              providerID: "test",
              mode: "build",
              agent: "build",
              path: { cwd: "/test", root: "/test" },
              cost: 0,
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            }),
      } as MessageV2.Info,
      parts,
    }
  }

  function createToolPart(
    tool: string,
    input: Record<string, unknown>,
    output: string,
    status: "completed" | "error" = "completed"
  ): MessageV2.ToolPart {
    return {
      id: "part_" + Math.random().toString(36).slice(2),
      sessionID: "session_test",
      messageID: "msg_test",
      type: "tool",
      callID: "call_" + Math.random().toString(36).slice(2),
      tool,
      state:
        status === "completed"
          ? {
              status: "completed",
              input,
              output,
              title: tool,
              metadata: {},
              time: { start: Date.now(), end: Date.now() },
            }
          : {
              status: "error",
              input,
              error: output,
              time: { start: Date.now(), end: Date.now() },
            },
    }
  }

  describe("extractFiles", () => {
    test("extracts files from Read tool calls", () => {
      const messages: MessageV2.WithParts[] = [
        createMockMessage("assistant", [
          createToolPart("Read", { file_path: "/src/main.ts" }, "file content here"),
          createToolPart("Read", { file_path: "/src/utils.ts" }, "more content"),
        ]),
      ]

      const result = DeterministicExtractor.extractFiles(messages)

      expect(result.files_read).toContain("/src/main.ts")
      expect(result.files_read).toContain("/src/utils.ts")
    })

    test("extracts files from Edit tool calls as modified", () => {
      const messages: MessageV2.WithParts[] = [
        createMockMessage("assistant", [
          createToolPart(
            "Edit",
            { file_path: "/src/main.ts", old_string: "foo", new_string: "bar" },
            "File edited successfully"
          ),
        ]),
      ]

      const result = DeterministicExtractor.extractFiles(messages)

      expect(result.files_modified.map((f) => f.path)).toContain("/src/main.ts")
    })

    test("extracts files from Write tool calls as created", () => {
      const messages: MessageV2.WithParts[] = [
        createMockMessage("assistant", [
          createToolPart(
            "Write",
            { file_path: "/src/new-file.ts", content: "new content" },
            "File written"
          ),
        ]),
      ]

      const result = DeterministicExtractor.extractFiles(messages)

      expect(result.files_created).toContain("/src/new-file.ts")
    })

    test("removes modified/created files from read set", () => {
      const messages: MessageV2.WithParts[] = [
        createMockMessage("assistant", [
          createToolPart("Read", { file_path: "/src/main.ts" }, "content"),
          createToolPart(
            "Edit",
            { file_path: "/src/main.ts", old_string: "a", new_string: "b" },
            "edited"
          ),
        ]),
      ]

      const result = DeterministicExtractor.extractFiles(messages)

      expect(result.files_read).not.toContain("/src/main.ts")
      expect(result.files_modified.map((f) => f.path)).toContain("/src/main.ts")
    })

    test("extracts change summary from Edit tool input", () => {
      const messages: MessageV2.WithParts[] = [
        createMockMessage("assistant", [
          createToolPart(
            "Edit",
            { file_path: "/src/main.ts", old_string: "function old()", new_string: "function new()" },
            "edited"
          ),
        ]),
      ]

      const result = DeterministicExtractor.extractFiles(messages)

      expect(result.files_modified[0].change_summary).toBeDefined()
    })

    test("handles Glob tool for file discovery", () => {
      const messages: MessageV2.WithParts[] = [
        createMockMessage("assistant", [
          createToolPart(
            "Glob",
            { pattern: "**/*.ts" },
            "/src/a.ts\n/src/b.ts\n/src/c.ts"
          ),
        ]),
      ]

      const result = DeterministicExtractor.extractFiles(messages)

      // Glob results should be noted but not added to files_read (they're discovered, not read)
      expect(result.files_read.length).toBe(0)
    })
  })

  describe("extractErrors", () => {
    test("extracts errors from tool output", () => {
      const messages: MessageV2.WithParts[] = [
        createMockMessage("assistant", [
          createToolPart("Bash", { command: "npm test" }, "Error: Test failed\nExpected 5 but got 3"),
        ]),
      ]

      const result = DeterministicExtractor.extractErrors(messages)

      expect(result.length).toBeGreaterThan(0)
      expect(result[0].message).toContain("Test failed")
    })

    test("detects TypeError patterns", () => {
      const messages: MessageV2.WithParts[] = [
        createMockMessage("assistant", [
          createToolPart(
            "Bash",
            { command: "node app.js" },
            "TypeError: Cannot read property 'foo' of undefined"
          ),
        ]),
      ]

      const result = DeterministicExtractor.extractErrors(messages)

      expect(result.some((e) => e.message.includes("TypeError"))).toBe(true)
    })

    test("marks errors as resolved when fix indicators appear later", () => {
      const messages: MessageV2.WithParts[] = [
        createMockMessage("assistant", [
          createToolPart("Bash", { command: "npm test" }, "Error: Test failed"),
        ]),
        createMockMessage("assistant", [
          createToolPart(
            "Edit",
            { file_path: "/src/test.ts", old_string: "a", new_string: "b" },
            "Fixed"
          ),
        ]),
        createMockMessage("assistant", [
          createToolPart("Bash", { command: "npm test" }, "All tests passed ✓"),
        ]),
      ]

      const result = DeterministicExtractor.extractErrors(messages)

      expect(result.some((e) => e.resolved)).toBe(true)
    })

    test("handles error tool status", () => {
      const messages: MessageV2.WithParts[] = [
        createMockMessage("assistant", [
          createToolPart("Bash", { command: "invalid" }, "Command not found", "error"),
        ]),
      ]

      const result = DeterministicExtractor.extractErrors(messages)

      expect(result.length).toBeGreaterThan(0)
    })
  })

  describe("extractToolCalls", () => {
    test("consolidates repeated tool calls", () => {
      const messages: MessageV2.WithParts[] = [
        createMockMessage("assistant", [
          createToolPart("Read", { file_path: "/a.ts" }, "content"),
          createToolPart("Read", { file_path: "/b.ts" }, "content"),
          createToolPart("Read", { file_path: "/c.ts" }, "content"),
        ]),
      ]

      const result = DeterministicExtractor.extractToolCalls(messages)

      const readSummary = result.find((t) => t.tool === "Read")
      expect(readSummary).toBeDefined()
      expect(readSummary?.summary).toContain("3x")
    })

    test("tracks success rate", () => {
      const messages: MessageV2.WithParts[] = [
        createMockMessage("assistant", [
          createToolPart("Bash", { command: "ls" }, "output"),
          createToolPart("Bash", { command: "cat" }, "error", "error"),
        ]),
      ]

      const result = DeterministicExtractor.extractToolCalls(messages)

      const bashSummary = result.find((t) => t.tool === "Bash")
      expect(bashSummary?.summary).toContain("1/2")
    })

    test("returns empty array for messages without tools", () => {
      const messages: MessageV2.WithParts[] = [
        createMockMessage("user", [
          {
            id: "part_1",
            sessionID: "session_test",
            messageID: "msg_test",
            type: "text",
            text: "Hello",
          } as MessageV2.TextPart,
        ]),
      ]

      const result = DeterministicExtractor.extractToolCalls(messages)

      expect(result).toEqual([])
    })
  })

  describe("condenseContext", () => {
    test("produces condensed representation from extraction results", () => {
      const artifacts = {
        files_read: ["/src/a.ts", "/src/b.ts"],
        files_modified: [{ path: "/src/c.ts", change_summary: "Added function" }],
        files_created: ["/src/d.ts"],
      }
      const errors = [{ message: "Type error", resolved: true }]
      const toolCalls = [{ tool: "Read", summary: "3x (3/3 successful)", success: true }]

      const condensed = DeterministicExtractor.condenseContext(artifacts, errors, toolCalls)

      expect(condensed).toContain("Files read: 2")
      expect(condensed).toContain("Files modified: 1")
      expect(condensed).toContain("Files created: 1")
      expect(condensed).toContain("Errors: 1 (1 resolved)")
    })
  })
})

// =============================================================================
// LLM EXTRACTOR TESTS
// =============================================================================

describe("compaction/llm-extractor", () => {
  describe("buildPrompt", () => {
    test("includes condensed context in prompt", () => {
      const condensedContext = "# Session Summary\n- Files read: 5\n- Files modified: 2"
      const recentMessages = "User: Help me fix this bug\nAssistant: Let me look at the code"

      const prompt = LLMExtractor.buildPrompt(condensedContext, recentMessages)

      expect(prompt).toContain(condensedContext)
      expect(prompt).toContain(recentMessages)
    })

    test("includes extraction instructions", () => {
      const prompt = LLMExtractor.buildPrompt("context", "messages")

      expect(prompt).toContain("session_intent")
      expect(prompt).toContain("current_state")
      expect(prompt).toContain("decisions")
      expect(prompt).toContain("pending_tasks")
      expect(prompt).toContain("key_context")
    })
  })

  describe("messagesToRecentContext", () => {
    test("converts messages to text format", () => {
      const messages: MessageV2.WithParts[] = [
        {
          info: {
            id: "msg_1",
            sessionID: "session_test",
            role: "user",
            time: { created: Date.now() },
            agent: "build",
            model: { providerID: "test", modelID: "test" },
          } as MessageV2.User,
          parts: [
            {
              id: "part_1",
              sessionID: "session_test",
              messageID: "msg_1",
              type: "text",
              text: "Please help me fix this bug",
            } as MessageV2.TextPart,
          ],
        },
      ]

      const result = LLMExtractor.messagesToRecentContext(messages)

      expect(result).toContain("USER:")
      expect(result).toContain("Please help me fix this bug")
    })

    test("limits to last N messages", () => {
      const messages: MessageV2.WithParts[] = Array.from({ length: 20 }, (_, i) => ({
        info: {
          id: `msg_${i}`,
          sessionID: "session_test",
          role: "user" as const,
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "test", modelID: "test" },
        } as MessageV2.User,
        parts: [
          {
            id: `part_${i}`,
            sessionID: "session_test",
            messageID: `msg_${i}`,
            type: "text" as const,
            text: `Message ${i}`,
          } as MessageV2.TextPart,
        ],
      }))

      const result = LLMExtractor.messagesToRecentContext(messages, 5)

      // Should only include last 5 messages
      expect(result).toContain("Message 15")
      expect(result).toContain("Message 19")
      expect(result).not.toContain("Message 0")
    })

    test("includes tool summaries", () => {
      const messages: MessageV2.WithParts[] = [
        {
          info: {
            id: "msg_1",
            sessionID: "session_test",
            role: "assistant",
            time: { created: Date.now() },
            parentID: "parent",
            modelID: "test",
            providerID: "test",
            mode: "build",
            agent: "build",
            path: { cwd: "/test", root: "/test" },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          } as MessageV2.Assistant,
          parts: [
            {
              id: "part_1",
              sessionID: "session_test",
              messageID: "msg_1",
              type: "tool",
              callID: "call_1",
              tool: "Read",
              state: {
                status: "completed",
                input: { file_path: "/src/main.ts" },
                output: "file content",
                title: "Read",
                metadata: {},
                time: { start: Date.now(), end: Date.now() },
              },
            } as MessageV2.ToolPart,
          ],
        },
      ]

      const result = LLMExtractor.messagesToRecentContext(messages)

      expect(result).toContain("[Tool: Read]")
    })
  })

  describe("parseResponse", () => {
    test("parses valid JSON response", () => {
      const response = JSON.stringify({
        session_intent: "Build a REST API",
        current_state: "API routes implemented",
        decisions: [{ decision: "Use Express", rationale: "Simple and well-known" }],
        pending_tasks: ["Add authentication", "Write tests"],
        key_context: "Node.js project with TypeScript",
      })

      const result = LLMExtractor.parseResponse(response)

      expect(result.session_intent).toBe("Build a REST API")
      expect(result.decisions).toHaveLength(1)
      expect(result.pending_tasks).toContain("Add authentication")
    })

    test("handles JSON with markdown code fence", () => {
      const response = `Here's the extraction:
\`\`\`json
{
  "session_intent": "Fix a bug",
  "current_state": "Debugging in progress",
  "decisions": [],
  "pending_tasks": ["Find root cause"],
  "key_context": "React application"
}
\`\`\`
`

      const result = LLMExtractor.parseResponse(response)

      expect(result.session_intent).toBe("Fix a bug")
    })

    test("returns default values for invalid JSON", () => {
      const response = "This is not valid JSON at all"

      const result = LLMExtractor.parseResponse(response)

      expect(result.session_intent).toBe("")
      expect(result.decisions).toEqual([])
      expect(result.pending_tasks).toEqual([])
    })

    test("handles partial JSON with missing fields", () => {
      const response = JSON.stringify({
        session_intent: "Some intent",
        // missing other fields
      })

      const result = LLMExtractor.parseResponse(response)

      expect(result.session_intent).toBe("Some intent")
      expect(result.current_state).toBe("")
      expect(result.decisions).toEqual([])
    })
  })

  describe("extractAgentContext", () => {
    test("extracts agent context from agent info", () => {
      const agentInfo = {
        name: "build",
        systemPrompt: "You are a helpful coding assistant. You must always use TypeScript. Never use any.",
      }

      const result = LLMExtractor.extractAgentContext(agentInfo)

      expect(result.agent_name).toBe("build")
      expect(result.agent_role).toBeDefined()
      expect(result.constraints).toBeDefined()
    })

    test("extracts constraints from system prompt", () => {
      const agentInfo = {
        name: "test",
        systemPrompt: "You must always validate input. You should never expose secrets. Only use approved libraries.",
      }

      const result = LLMExtractor.extractAgentContext(agentInfo)

      expect(result.constraints?.length).toBeGreaterThan(0)
    })

    test("returns undefined for missing info", () => {
      const result = LLMExtractor.extractAgentContext(undefined)

      expect(result).toBeUndefined()
    })
  })
})
