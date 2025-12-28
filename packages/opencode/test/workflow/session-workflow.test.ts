import { describe, test, expect, beforeAll } from "bun:test"
import { WorkflowRegistry } from "@/workflow/registry"
import type { WorkflowStrategy } from "@/workflow/strategy"
import { Session } from "@/session"
import { Instance } from "@/project/instance"
import { tmpdir } from "../fixture/fixture"

// Create a simple mock strategy for testing
const mockStrategy: WorkflowStrategy.Strategy = {
  id: "traditional",
  name: "Traditional",
  description: "Traditional workflow",
  metadata: { config: {}, state: {}, version: 1 },

  async onCreate() {
    return { metadata: { initialized: true } }
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

describe("Session with Workflow", () => {
  beforeAll(() => {
    // Register mock strategy before tests
    WorkflowRegistry.clear()
    WorkflowRegistry.register(mockStrategy)
  })

  test("creates session with default workflow when not specified", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create()
        const info = await Session.get(session.id)

        // Should have workflow metadata
        expect(info.workflow).toBeDefined()
        expect(info.workflow?.strategyID).toBe("traditional")
      },
    })
  })

  test("creates session with specified workflow", async () => {
    await using tmp = await tmpdir({ git: true })

    // Register a second strategy
    const hierarchicalStrategy = { ...mockStrategy, id: "hierarchical", name: "Hierarchical" }
    WorkflowRegistry.register(hierarchicalStrategy)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({
          workflowID: "hierarchical",
        })
        const info = await Session.get(session.id)

        expect(info.workflow).toBeDefined()
        expect(info.workflow?.strategyID).toBe("hierarchical")
      },
    })
  })

  test("stores workflow state in session", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({
          workflowID: "traditional",
        })
        const info = await Session.get(session.id)

        expect(info.workflow?.state).toBeDefined()
        expect(typeof info.workflow?.state).toBe("object")
      },
    })
  })

  test("retrieves workflow strategy for session", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({
          workflowID: "traditional",
        })

        const strategy = await WorkflowRegistry.getForSession(session.id)

        expect(strategy).toBeDefined()
        expect(strategy.id).toBe("traditional")
        expect(strategy.name).toBe("Traditional")
      },
    })
  })

  test("calls strategy onCreate when session is created", async () => {
    await using tmp = await tmpdir({ git: true })

    let onCreateCalled = false
    const trackedStrategy: WorkflowStrategy.Strategy = {
      ...mockStrategy,
      id: "tracked",
      async onCreate() {
        onCreateCalled = true
        return {}
      },
    }

    WorkflowRegistry.register(trackedStrategy)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Session.create({
          workflowID: "tracked",
        })

        expect(onCreateCalled).toBe(true)
      },
    })
  })
})
