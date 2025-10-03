import { describe, expect, test } from "bun:test"
import { Heuristics } from "../../src/evaluation/heuristics"
import type { Trace } from "../../src/trace"

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
  output: "Test output",
  toolCalls: [],
  summary: {
    duration: 1000,
    toolCallCount: 0,
    errorCount: 0,
    tokens: {
      input: 100,
      output: 50,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    cost: 0.01,
  },
  evaluationIDs: [],
  createdAt: Date.now(),
  ...overrides,
})

describe("Heuristics", () => {
  describe("toolErrorRate", () => {
    test("returns 0 when no tool calls", () => {
      const trace = createMockTrace()
      expect(Heuristics.toolErrorRate(trace)).toBe(0)
    })

    test("returns 0 when all tools succeed", () => {
      const trace = createMockTrace({
        toolCalls: [
          { status: "success", duration: 100 },
          { status: "success", duration: 200 },
        ] as any,
      })
      expect(Heuristics.toolErrorRate(trace)).toBe(0)
    })

    test("returns correct error rate", () => {
      const trace = createMockTrace({
        toolCalls: [
          { status: "success", duration: 100 },
          { status: "error", duration: 200 },
          { status: "success", duration: 150 },
          { status: "error", duration: 180 },
        ] as any,
      })
      expect(Heuristics.toolErrorRate(trace)).toBe(0.5)
    })
  })

  describe("responseDuration", () => {
    test("returns the trace duration", () => {
      const trace = createMockTrace({ summary: { ...createMockTrace().summary, duration: 5000 } })
      expect(Heuristics.responseDuration(trace)).toBe(5000)
    })
  })

  describe("costEfficiency", () => {
    test("returns Infinity when no successful calls", () => {
      const trace = createMockTrace({
        toolCalls: [{ status: "error", duration: 100 }] as any,
        summary: { ...createMockTrace().summary, cost: 0.05 },
      })
      expect(Heuristics.costEfficiency(trace)).toBe(Infinity)
    })

    test("calculates cost per successful operation", () => {
      const trace = createMockTrace({
        toolCalls: [
          { status: "success", duration: 100 },
          { status: "success", duration: 200 },
          { status: "error", duration: 150 },
        ] as any,
        summary: { ...createMockTrace().summary, cost: 0.10 },
      })
      expect(Heuristics.costEfficiency(trace)).toBe(0.05)
    })
  })

  describe("tokenEfficiency", () => {
    test("returns 0 when no tokens used", () => {
      const trace = createMockTrace({
        summary: {
          ...createMockTrace().summary,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        },
      })
      expect(Heuristics.tokenEfficiency(trace)).toBe(0)
    })

    test("calculates output ratio correctly", () => {
      const trace = createMockTrace({
        summary: {
          ...createMockTrace().summary,
          tokens: { input: 100, output: 50, reasoning: 50, cache: { read: 0, write: 0 } },
        },
      })
      expect(Heuristics.tokenEfficiency(trace)).toBe(0.25) // 50 / 200
    })
  })

  describe("toolSuccessRate", () => {
    test("returns 1 when no tool calls", () => {
      const trace = createMockTrace()
      expect(Heuristics.toolSuccessRate(trace)).toBe(1)
    })

    test("calculates success rate correctly", () => {
      const trace = createMockTrace({
        toolCalls: [
          { status: "success", duration: 100 },
          { status: "success", duration: 200 },
          { status: "error", duration: 150 },
        ] as any,
      })
      expect(Heuristics.toolSuccessRate(trace)).toBeCloseTo(0.666, 2)
    })
  })

  describe("hasErrors", () => {
    test("returns 0 when no errors", () => {
      const trace = createMockTrace()
      expect(Heuristics.hasErrors(trace)).toBe(0)
    })

    test("returns 1 when errors present", () => {
      const trace = createMockTrace({
        summary: { ...createMockTrace().summary, errorCount: 2 },
      })
      expect(Heuristics.hasErrors(trace)).toBe(1)
    })
  })

  describe("cacheHitRate", () => {
    test("returns 0 when no cache usage", () => {
      const trace = createMockTrace()
      expect(Heuristics.cacheHitRate(trace)).toBe(0)
    })

    test("calculates cache hit rate", () => {
      const trace = createMockTrace({
        summary: {
          ...createMockTrace().summary,
          tokens: { input: 80, output: 50, reasoning: 0, cache: { read: 20, write: 0 } },
        },
      })
      expect(Heuristics.cacheHitRate(trace)).toBe(0.2) // 20 / (80 + 20)
    })
  })

  describe("totalCost", () => {
    test("returns the trace cost", () => {
      const trace = createMockTrace({
        summary: { ...createMockTrace().summary, cost: 1.25 },
      })
      expect(Heuristics.totalCost(trace)).toBe(1.25)
    })
  })
})
