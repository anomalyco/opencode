import { describe, expect, test } from "bun:test"
import { TestRunner } from "../../src/evaluation/runner"
import type { Trace } from "../../src/trace"
import type { Dataset } from "../../src/evaluation/dataset"

const createMockTrace = (overrides?: Partial<Trace.Complete>): Trace.Complete => ({
  id: "test-trace-1",
  projectID: "test-project",
  session: {
    id: "test-session",
    projectID: "test-project",
    directory: "/test",
    title: "Test Session",
    version: "1.0.0",
    time: {
      created: Date.now(),
      updated: Date.now(),
    },
  },
  messageCount: 3,
  agentName: "test-agent",
  modelConfig: {
    provider: "anthropic",
    model: "claude-3-5-sonnet-20241022",
  },
  output: "Hello, I can help you with that task!",
  toolCalls: [
    { id: "Read", status: "success", duration: 100 } as any,
    { id: "Edit", status: "success", duration: 200 } as any,
  ],
  summary: {
    duration: 1500,
    toolCallCount: 2,
    errorCount: 0,
    tokens: {
      input: 100,
      output: 50,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    cost: 0.02,
  },
  evaluationIDs: [],
  createdAt: Date.now(),
  ...overrides,
})

describe("TestRunner - Assertions", () => {
  describe("tool-called assertion", () => {
    test("passes when tool is called", async () => {
      const trace = createMockTrace()
      const assertion: Dataset.Assertion = {
        type: "tool-called",
        toolID: "Read",
      }

      const results = await TestRunner.runAssertions(trace, [assertion])
      expect(results).toHaveLength(1)
      expect(results[0].passed).toBe(true)
      expect(results[0].message).toContain("Read")
    })

    test("fails when tool is not called", async () => {
      const trace = createMockTrace()
      const assertion: Dataset.Assertion = {
        type: "tool-called",
        toolID: "NonExistent",
      }

      const results = await TestRunner.runAssertions(trace, [assertion])
      expect(results[0].passed).toBe(false)
    })

    test("respects minCount", async () => {
      const trace = createMockTrace({
        toolCalls: [
          { id: "Read", status: "success", duration: 100 } as any,
          { id: "Read", status: "success", duration: 120 } as any,
        ],
      })

      const assertion: Dataset.Assertion = {
        type: "tool-called",
        toolID: "Read",
        minCount: 2,
      }

      const results = await TestRunner.runAssertions(trace, [assertion])
      expect(results[0].passed).toBe(true)
    })

    test("respects maxCount", async () => {
      const trace = createMockTrace({
        toolCalls: [
          { id: "Read", status: "success", duration: 100 } as any,
          { id: "Read", status: "success", duration: 120 } as any,
          { id: "Read", status: "success", duration: 130 } as any,
        ],
      })

      const assertion: Dataset.Assertion = {
        type: "tool-called",
        toolID: "Read",
        maxCount: 2,
      }

      const results = await TestRunner.runAssertions(trace, [assertion])
      expect(results[0].passed).toBe(false)
    })
  })

  describe("output-matches assertion", () => {
    test("passes when pattern matches", async () => {
      const trace = createMockTrace()
      const assertion: Dataset.Assertion = {
        type: "output-matches",
        pattern: "help.*task",
      }

      const results = await TestRunner.runAssertions(trace, [assertion])
      expect(results[0].passed).toBe(true)
    })

    test("fails when pattern doesn't match", async () => {
      const trace = createMockTrace()
      const assertion: Dataset.Assertion = {
        type: "output-matches",
        pattern: "goodbye",
      }

      const results = await TestRunner.runAssertions(trace, [assertion])
      expect(results[0].passed).toBe(false)
    })

    test("supports flags", async () => {
      const trace = createMockTrace()
      const assertion: Dataset.Assertion = {
        type: "output-matches",
        pattern: "HELLO",
        flags: "i",
      }

      const results = await TestRunner.runAssertions(trace, [assertion])
      expect(results[0].passed).toBe(true)
    })
  })

  describe("output-contains assertion", () => {
    test("passes when substring is found", async () => {
      const trace = createMockTrace()
      const assertion: Dataset.Assertion = {
        type: "output-contains",
        substring: "help",
      }

      const results = await TestRunner.runAssertions(trace, [assertion])
      expect(results[0].passed).toBe(true)
    })

    test("fails when substring is not found", async () => {
      const trace = createMockTrace()
      const assertion: Dataset.Assertion = {
        type: "output-contains",
        substring: "error",
      }

      const results = await TestRunner.runAssertions(trace, [assertion])
      expect(results[0].passed).toBe(false)
    })
  })

  describe("no-errors assertion", () => {
    test("passes when no errors", async () => {
      const trace = createMockTrace()
      const assertion: Dataset.Assertion = {
        type: "no-errors",
      }

      const results = await TestRunner.runAssertions(trace, [assertion])
      expect(results[0].passed).toBe(true)
    })

    test("fails when errors present", async () => {
      const trace = createMockTrace({
        summary: { ...createMockTrace().summary, errorCount: 2 },
      })
      const assertion: Dataset.Assertion = {
        type: "no-errors",
      }

      const results = await TestRunner.runAssertions(trace, [assertion])
      expect(results[0].passed).toBe(false)
      expect(results[0].message).toContain("2 error")
    })
  })

  describe("duration-under assertion", () => {
    test("passes when under threshold", async () => {
      const trace = createMockTrace()
      const assertion: Dataset.Assertion = {
        type: "duration-under",
        milliseconds: 2000,
      }

      const results = await TestRunner.runAssertions(trace, [assertion])
      expect(results[0].passed).toBe(true)
    })

    test("fails when over threshold", async () => {
      const trace = createMockTrace()
      const assertion: Dataset.Assertion = {
        type: "duration-under",
        milliseconds: 1000,
      }

      const results = await TestRunner.runAssertions(trace, [assertion])
      expect(results[0].passed).toBe(false)
    })
  })

  describe("cost-under assertion", () => {
    test("passes when under threshold", async () => {
      const trace = createMockTrace()
      const assertion: Dataset.Assertion = {
        type: "cost-under",
        dollars: 0.05,
      }

      const results = await TestRunner.runAssertions(trace, [assertion])
      expect(results[0].passed).toBe(true)
    })

    test("fails when over threshold", async () => {
      const trace = createMockTrace()
      const assertion: Dataset.Assertion = {
        type: "cost-under",
        dollars: 0.01,
      }

      const results = await TestRunner.runAssertions(trace, [assertion])
      expect(results[0].passed).toBe(false)
    })
  })

  describe("custom assertion", () => {
    test("passes when expression evaluates to true", async () => {
      const trace = createMockTrace()
      const assertion: Dataset.Assertion = {
        type: "custom",
        expression: "trace.toolCalls.length === 2",
        description: "Should have exactly 2 tool calls",
      }

      const results = await TestRunner.runAssertions(trace, [assertion])
      expect(results[0].passed).toBe(true)
    })

    test("fails when expression evaluates to false", async () => {
      const trace = createMockTrace()
      const assertion: Dataset.Assertion = {
        type: "custom",
        expression: "trace.summary.cost > 1.0",
        description: "Cost should be high",
      }

      const results = await TestRunner.runAssertions(trace, [assertion])
      expect(results[0].passed).toBe(false)
    })

    test("handles expression errors gracefully", async () => {
      const trace = createMockTrace()
      const assertion: Dataset.Assertion = {
        type: "custom",
        expression: "trace.nonExistent.property",
        description: "Invalid expression",
      }

      const results = await TestRunner.runAssertions(trace, [assertion])
      expect(results[0].passed).toBe(false)
      expect(results[0].message).toContain("failed")
    })
  })

  describe("multiple assertions", () => {
    test("runs all assertions independently", async () => {
      const trace = createMockTrace()
      const assertions: Dataset.Assertion[] = [
        { type: "tool-called", toolID: "Read" },
        { type: "output-contains", substring: "help" },
        { type: "no-errors" },
        { type: "duration-under", milliseconds: 2000 },
      ]

      const results = await TestRunner.runAssertions(trace, assertions)
      expect(results).toHaveLength(4)
      expect(results.every((r) => r.passed)).toBe(true)
    })
  })
})
