import { describe, test, expect, beforeEach } from "bun:test"
import { WorkflowRegistry } from "@/workflow/registry"
import type { WorkflowStrategy } from "@/workflow/strategy"

describe("WorkflowRegistry", () => {
  beforeEach(() => {
    // Clear registry before each test
    WorkflowRegistry.clear()
  })

  test("registers a workflow strategy", () => {
    const mockStrategy = createMockStrategy("test", "Test Strategy")

    WorkflowRegistry.register(mockStrategy)
    const retrieved = WorkflowRegistry.get("test")

    expect(retrieved).toBeDefined()
    expect(retrieved.id).toBe("test")
    expect(retrieved.name).toBe("Test Strategy")
  })

  test("throws error when strategy not found", () => {
    expect(() => WorkflowRegistry.get("nonexistent")).toThrow(
      "Workflow strategy not found: nonexistent"
    )
  })

  test("lists all registered strategies", () => {
    const strategy1 = createMockStrategy("strategy1", "Strategy 1")
    const strategy2 = createMockStrategy("strategy2", "Strategy 2")

    WorkflowRegistry.register(strategy1)
    WorkflowRegistry.register(strategy2)

    const list = WorkflowRegistry.list()
    expect(list).toHaveLength(2)
    expect(list.map(s => s.id)).toContain("strategy1")
    expect(list.map(s => s.id)).toContain("strategy2")
  })

  test("overwrites existing strategy on re-register", () => {
    const strategy1 = createMockStrategy("duplicate", "First")
    const strategy2 = createMockStrategy("duplicate", "Second")

    WorkflowRegistry.register(strategy1)
    WorkflowRegistry.register(strategy2)

    const retrieved = WorkflowRegistry.get("duplicate")
    expect(retrieved.name).toBe("Second")
  })

  test("clears all registered strategies", () => {
    const strategy1 = createMockStrategy("strategy1", "Strategy 1")
    const strategy2 = createMockStrategy("strategy2", "Strategy 2")

    WorkflowRegistry.register(strategy1)
    WorkflowRegistry.register(strategy2)

    expect(WorkflowRegistry.list()).toHaveLength(2)

    WorkflowRegistry.clear()

    expect(WorkflowRegistry.list()).toHaveLength(0)
  })
})

// Helper function to create mock strategies
function createMockStrategy(id: string, name: string): WorkflowStrategy.Strategy {
  return {
    id,
    name,
    description: "Mock strategy for testing",
    metadata: { config: {}, state: {}, version: 1 },

    async onCreate() {
      return {}
    },

    async onMessage() {
      return { shouldProcess: true }
    },

    async beforeProcess() {
      return {}
    },

    async afterProcess() {
      return { shouldContinue: false }
    },

    async buildContext() {
      return { messages: [], metadata: {} }
    },

    async shouldCompact() {
      return false
    },

    async handleCompaction() {
      return { shouldStop: false }
    },

    async getMessagesForDisplay() {
      return []
    },

    async getMessagesForContext() {
      return []
    },

    async saveState() {},

    async loadState() {},
  }
}
