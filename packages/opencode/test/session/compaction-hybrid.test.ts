import { describe, expect, test } from "bun:test"
import { CompactionSchema } from "../../src/session/compaction/schema"

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
