import { describe, expect, test } from "bun:test"
import type { CallTraceItem } from "../../../src/cli/cmd/tui/context/call-trace"
import {
  formatDuration,
  formatTime,
  truncate,
  formatTokens,
  formatCost,
  formatInput,
  formatOutput,
} from "../../../src/cli/cmd/tui/component/call-trace-helpers"

describe("call-trace-helpers", () => {
  describe("formatDuration", () => {
    test("formats milliseconds under 1000", () => {
      expect(formatDuration(0)).toBe("0ms")
      expect(formatDuration(100)).toBe("100ms")
      expect(formatDuration(500)).toBe("500ms")
      expect(formatDuration(999)).toBe("999ms")
    })

    test("formats seconds for values >= 1000", () => {
      expect(formatDuration(1000)).toBe("1.0s")
      expect(formatDuration(1500)).toBe("1.5s")
      expect(formatDuration(2000)).toBe("2.0s")
      expect(formatDuration(10000)).toBe("10.0s")
    })
  })

  describe("formatTime", () => {
    test("formats timestamp to HH:MM:SS", () => {
      const timestamp = 1705314645000
      const result = formatTime(timestamp)
      expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/)
    })
  })

  describe("truncate", () => {
    test("returns empty string for undefined input", () => {
      expect(truncate(undefined, 10)).toBe("")
    })

    test("returns empty string for empty string input", () => {
      expect(truncate("", 10)).toBe("")
    })

    test("returns original string if within max length", () => {
      expect(truncate("hello", 10)).toBe("hello")
      expect(truncate("hello", 5)).toBe("hello")
    })

    test("truncates and adds ellipsis when exceeding max length", () => {
      expect(truncate("hello world", 5)).toBe("hell…")
      expect(truncate("hello world", 8)).toBe("hello w…")
    })
  })

  describe("formatTokens", () => {
    test("returns empty string for undefined tokens", () => {
      expect(formatTokens(undefined)).toBe("")
    })

    test("formats token counts", () => {
      expect(formatTokens({ input: 100, output: 200 })).toBe("100→200")
      expect(formatTokens({ input: 0, output: 0 })).toBe("0→0")
      expect(formatTokens({ input: 1000, output: 5000 })).toBe("1000→5000")
    })
  })

  describe("formatCost", () => {
    test("returns empty string for undefined cost", () => {
      expect(formatCost(undefined)).toBe("")
    })

    test("formats cost with 4 decimal places", () => {
      expect(formatCost(0)).toBe("$0.0000")
      expect(formatCost(0.1234)).toBe("$0.1234")
      expect(formatCost(1.5)).toBe("$1.5000")
      expect(formatCost(100)).toBe("$100.0000")
    })
  })

  describe("formatInput", () => {
    test("returns inputSummary if provided", () => {
      const trace: CallTraceItem = {
        id: "1",
        type: "llm",
        source: "LLM",
        name: "test",
        component: "test",
        startTime: Date.now(),
        status: "completed",
        inputSummary: "Custom summary",
      }
      expect(formatInput(trace)).toBe("Custom summary")
    })

    test("formats LLM trace with provider and model", () => {
      const trace: CallTraceItem = {
        id: "1",
        type: "llm",
        source: "LLM",
        name: "test",
        component: "test",
        startTime: Date.now(),
        status: "completed",
        providerID: "anthropic",
        modelID: "claude-3",
      }
      expect(formatInput(trace)).toBe("anthropic | claude-3")
    })

    test("formats LLM trace with tokens", () => {
      const trace: CallTraceItem = {
        id: "1",
        type: "llm",
        source: "LLM",
        name: "test",
        component: "test",
        startTime: Date.now(),
        status: "completed",
        providerID: "anthropic",
        modelID: "claude-3",
        tokens: { input: 100, output: 200 },
      }
      expect(formatInput(trace)).toBe("anthropic | claude-3 | tokens: 100")
    })

    test("returns 'LLM call' for LLM trace without details", () => {
      const trace: CallTraceItem = {
        id: "1",
        type: "llm",
        source: "LLM",
        name: "test",
        component: "test",
        startTime: Date.now(),
        status: "completed",
      }
      expect(formatInput(trace)).toBe("LLM call")
    })

    test("formats tool trace with name and params", () => {
      const trace: CallTraceItem = {
        id: "1",
        type: "tool",
        source: "OC",
        name: "test",
        component: "test",
        startTime: Date.now(),
        status: "completed",
        toolName: "read",
        input: { path: "/file.txt", encoding: "utf-8" },
      }
      expect(formatInput(trace)).toBe("read(path, encoding)")
    })

    test("returns 'Tool call' for tool trace without name", () => {
      const trace: CallTraceItem = {
        id: "1",
        type: "tool",
        source: "OC",
        name: "test",
        component: "test",
        startTime: Date.now(),
        status: "completed",
      }
      expect(formatInput(trace)).toBe("Tool call")
    })

    test("formats OMO trace with agentName", () => {
      const trace: CallTraceItem = {
        id: "1",
        type: "omo",
        source: "OMO",
        name: "test",
        component: "test",
        startTime: Date.now(),
        status: "completed",
        agentName: "explore",
      }
      expect(formatInput(trace)).toBe("explore")
    })

    test("formats OMO trace with description fallback", () => {
      const trace: CallTraceItem = {
        id: "1",
        type: "omo",
        source: "OMO",
        name: "test",
        component: "test",
        startTime: Date.now(),
        status: "completed",
        description: "Searching codebase",
      }
      expect(formatInput(trace)).toBe("Searching codebase")
    })

    test("returns 'OMO agent' for OMO trace without details", () => {
      const trace: CallTraceItem = {
        id: "1",
        type: "omo",
        source: "OMO",
        name: "test",
        component: "test",
        startTime: Date.now(),
        status: "completed",
      }
      expect(formatInput(trace)).toBe("OMO agent")
    })

    test("returns empty string for unknown trace type", () => {
      const trace: CallTraceItem = {
        id: "1",
        type: "unknown",
        source: "OC",
        name: "test",
        component: "test",
        startTime: Date.now(),
        status: "completed",
      }
      expect(formatInput(trace)).toBe("")
    })
  })

  describe("formatOutput", () => {
    test("returns outputSummary if provided", () => {
      const trace: CallTraceItem = {
        id: "1",
        type: "llm",
        source: "LLM",
        name: "test",
        component: "test",
        startTime: Date.now(),
        status: "completed",
        outputSummary: "Custom output",
      }
      expect(formatOutput(trace)).toBe("Custom output")
    })

    test("formats LLM trace with output tokens and cost", () => {
      const trace: CallTraceItem = {
        id: "1",
        type: "llm",
        source: "LLM",
        name: "test",
        component: "test",
        startTime: Date.now(),
        status: "completed",
        tokens: { input: 100, output: 200 },
        cost: 0.0025,
      }
      expect(formatOutput(trace)).toBe("tokens: 200 | $0.0025")
    })

    test("formats LLM trace with only tokens", () => {
      const trace: CallTraceItem = {
        id: "1",
        type: "llm",
        source: "LLM",
        name: "test",
        component: "test",
        startTime: Date.now(),
        status: "completed",
        tokens: { input: 100, output: 200 },
      }
      expect(formatOutput(trace)).toBe("tokens: 200")
    })

    test("formats LLM trace with only cost", () => {
      const trace: CallTraceItem = {
        id: "1",
        type: "llm",
        source: "LLM",
        name: "test",
        component: "test",
        startTime: Date.now(),
        status: "completed",
        cost: 0.0025,
      }
      expect(formatOutput(trace)).toBe("$0.0025")
    })

    test("returns empty string for LLM trace without details", () => {
      const trace: CallTraceItem = {
        id: "1",
        type: "llm",
        source: "LLM",
        name: "test",
        component: "test",
        startTime: Date.now(),
        status: "completed",
      }
      expect(formatOutput(trace)).toBe("")
    })

    test("formats tool trace with truncated output", () => {
      const longOutput = "a".repeat(150)
      const trace: CallTraceItem = {
        id: "1",
        type: "tool",
        source: "OC",
        name: "test",
        component: "test",
        startTime: Date.now(),
        status: "completed",
        output: longOutput,
      }
      const result = formatOutput(trace)
      expect(result.length).toBeLessThanOrEqual(100)
      expect(result.endsWith("…")).toBe(true)
    })

    test("formats tool trace with short output", () => {
      const trace: CallTraceItem = {
        id: "1",
        type: "tool",
        source: "OC",
        name: "test",
        component: "test",
        startTime: Date.now(),
        status: "completed",
        output: "Short output",
      }
      expect(formatOutput(trace)).toBe("Short output")
    })

    test("returns empty string for tool trace without output", () => {
      const trace: CallTraceItem = {
        id: "1",
        type: "tool",
        source: "OC",
        name: "test",
        component: "test",
        startTime: Date.now(),
        status: "completed",
      }
      expect(formatOutput(trace)).toBe("")
    })

    test("formats OMO trace with sessionID", () => {
      const trace: CallTraceItem = {
        id: "1",
        type: "omo",
        source: "OMO",
        name: "test",
        component: "test",
        startTime: Date.now(),
        status: "completed",
        sessionID: "ses_abc123",
      }
      expect(formatOutput(trace)).toBe("session: ses_abc123")
    })

    test("returns empty string for OMO trace without sessionID", () => {
      const trace: CallTraceItem = {
        id: "1",
        type: "omo",
        source: "OMO",
        name: "test",
        component: "test",
        startTime: Date.now(),
        status: "completed",
      }
      expect(formatOutput(trace)).toBe("")
    })

    test("returns empty string for unknown trace type", () => {
      const trace: CallTraceItem = {
        id: "1",
        type: "unknown",
        source: "OC",
        name: "test",
        component: "test",
        startTime: Date.now(),
        status: "completed",
      }
      expect(formatOutput(trace)).toBe("")
    })
  })
})
