/**
 * Integration Test: Plan Lifecycle
 *
 * Tests the complete lifecycle of plan updates through the ACP translator,
 * simulating realistic agent behavior when updating plan status.
 */

import { describe, expect, test, beforeEach } from "bun:test"
import type { SessionNotification } from "@agentclientprotocol/sdk"
import path from "path"
import { Plan } from "../../../src/session/plan"
import { Bus } from "../../../src/bus"
import { Log } from "../../../src/util/log"
import { Instance } from "../../../src/project/instance"
import { ACPTranslator } from "../../../src/acp/translator"

const projectRoot = path.join(__dirname, "../../..")
Log.init({ print: false })

describe("Plan lifecycle through ACP translator", () => {
  test("should preserve all plan items when marking one as complete", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const sessionID = "test-session-" + Math.random().toString(36).slice(2)

        // Agent creates initial plan with 3 tasks
        const initialPlanNotification: SessionNotification = {
          sessionId: sessionID,
          update: {
            sessionUpdate: "plan",
            entries: [
              {
                content: "Task 1: Setup database",
                priority: "high",
                status: "pending",
              },
              {
                content: "Task 2: Create API endpoints",
                priority: "medium",
                status: "pending",
              },
              {
                content: "Task 3: Write tests",
                priority: "low",
                status: "pending",
              },
            ],
          },
        }

        await ACPTranslator.translate(sessionID, initialPlanNotification)

        let entries = await Plan.get(sessionID)
        expect(entries).toHaveLength(3)

        // Agent starts working on task 1
        const task1InProgressNotification: SessionNotification = {
          sessionId: sessionID,
          update: {
            sessionUpdate: "plan",
            entries: [
              {
                content: "Task 1: Setup database",
                priority: "high",
                status: "in_progress", // Changed to in_progress
              },
              {
                content: "Task 2: Create API endpoints",
                priority: "medium",
                status: "pending",
              },
              {
                content: "Task 3: Write tests",
                priority: "low",
                status: "pending",
              },
            ],
          },
        }

        await ACPTranslator.translate(sessionID, task1InProgressNotification)

        entries = await Plan.get(sessionID)
        expect(entries).toHaveLength(3)
        expect(entries[0].status).toBe("in_progress")
        expect(entries[1].status).toBe("pending")
        expect(entries[2].status).toBe("pending")

        // Agent completes task 1
        // CRITICAL: Agent MUST send ALL entries, not just the completed one
        const task1CompletedNotification: SessionNotification = {
          sessionId: sessionID,
          update: {
            sessionUpdate: "plan",
            entries: [
              {
                content: "Task 1: Setup database",
                priority: "high",
                status: "completed", // Changed to completed
              },
              {
                content: "Task 2: Create API endpoints",
                priority: "medium",
                status: "pending",
              },
              {
                content: "Task 3: Write tests",
                priority: "low",
                status: "pending",
              },
            ],
          },
        }

        await ACPTranslator.translate(sessionID, task1CompletedNotification)

        entries = await Plan.get(sessionID)

        // BUG: If plan is cleared, this will fail
        expect(entries).toHaveLength(3)
        expect(entries[0].status).toBe("completed")
        expect(entries[1].status).toBe("pending")
        expect(entries[2].status).toBe("pending")
      },
    })
  })

  test("should handle agent sending only completed items (incorrect behavior)", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const sessionID = "test-session-" + Math.random().toString(36).slice(2)

        // Initial plan
        const initialPlanNotification: SessionNotification = {
          sessionId: sessionID,
          update: {
            sessionUpdate: "plan",
            entries: [
              {
                content: "Task 1",
                priority: "high",
                status: "pending",
              },
              {
                content: "Task 2",
                priority: "medium",
                status: "pending",
              },
            ],
          },
        }

        await ACPTranslator.translate(sessionID, initialPlanNotification)

        // Agent incorrectly sends only completed item (violates spec)
        // Per spec: "The Agent MUST send a complete list of all plan entries"
        const incorrectUpdateNotification: SessionNotification = {
          sessionId: sessionID,
          update: {
            sessionUpdate: "plan",
            entries: [
              {
                content: "Task 1",
                priority: "high",
                status: "completed",
              },
              // Missing Task 2 - this violates the spec but we should handle it
            ],
          },
        }

        await ACPTranslator.translate(sessionID, incorrectUpdateNotification)

        const entries = await Plan.get(sessionID)

        // This correctly clears Task 2 because agent sent incomplete list
        // This is expected per spec: "Client MUST replace the current plan completely"
        expect(entries).toHaveLength(1)
        expect(entries[0].content).toBe("Task 1")
        expect(entries[0].status).toBe("completed")
      },
    })
  })

  test("should handle plan with all items completed", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const sessionID = "test-session-" + Math.random().toString(36).slice(2)

        // Initial plan
        const initialPlanNotification: SessionNotification = {
          sessionId: sessionID,
          update: {
            sessionUpdate: "plan",
            entries: [
              {
                content: "Task 1",
                priority: "high",
                status: "pending",
              },
              {
                content: "Task 2",
                priority: "medium",
                status: "pending",
              },
            ],
          },
        }

        await ACPTranslator.translate(sessionID, initialPlanNotification)

        // All tasks completed
        const allCompletedNotification: SessionNotification = {
          sessionId: sessionID,
          update: {
            sessionUpdate: "plan",
            entries: [
              {
                content: "Task 1",
                priority: "high",
                status: "completed",
              },
              {
                content: "Task 2",
                priority: "medium",
                status: "completed",
              },
            ],
          },
        }

        await ACPTranslator.translate(sessionID, allCompletedNotification)

        const entries = await Plan.get(sessionID)
        expect(entries).toHaveLength(2)
        expect(entries[0].status).toBe("completed")
        expect(entries[1].status).toBe("completed")
      },
    })
  })

  test("should handle agent adding new tasks mid-execution", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const sessionID = "test-session-" + Math.random().toString(36).slice(2)

        // Initial plan
        const initialPlanNotification: SessionNotification = {
          sessionId: sessionID,
          update: {
            sessionUpdate: "plan",
            entries: [
              {
                content: "Task 1",
                priority: "high",
                status: "pending",
              },
            ],
          },
        }

        await ACPTranslator.translate(sessionID, initialPlanNotification)

        // Agent discovers more work and adds new tasks
        const expandedPlanNotification: SessionNotification = {
          sessionId: sessionID,
          update: {
            sessionUpdate: "plan",
            entries: [
              {
                content: "Task 1",
                priority: "high",
                status: "in_progress",
              },
              {
                content: "Task 2: Newly discovered",
                priority: "medium",
                status: "pending",
              },
              {
                content: "Task 3: Also new",
                priority: "low",
                status: "pending",
              },
            ],
          },
        }

        await ACPTranslator.translate(sessionID, expandedPlanNotification)

        const entries = await Plan.get(sessionID)
        expect(entries).toHaveLength(3)
        expect(entries[0].status).toBe("in_progress")
        expect(entries[1].content).toBe("Task 2: Newly discovered")
        expect(entries[2].content).toBe("Task 3: Also new")
      },
    })
  })

  test("should handle empty plan (all tasks removed)", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const sessionID = "test-session-" + Math.random().toString(36).slice(2)

        // Initial plan
        const initialPlanNotification: SessionNotification = {
          sessionId: sessionID,
          update: {
            sessionUpdate: "plan",
            entries: [
              {
                content: "Task 1",
                priority: "high",
                status: "pending",
              },
            ],
          },
        }

        await ACPTranslator.translate(sessionID, initialPlanNotification)

        // Agent removes all tasks
        const emptyPlanNotification: SessionNotification = {
          sessionId: sessionID,
          update: {
            sessionUpdate: "plan",
            entries: [],
          },
        }

        await ACPTranslator.translate(sessionID, emptyPlanNotification)

        const entries = await Plan.get(sessionID)
        expect(entries).toHaveLength(0)
      },
    })
  })
})
