/**
 * Unit Test: Plan Translation
 *
 * Tests plan notification extraction and bus event emission
 */

import { describe, expect, test } from "bun:test"
import type { SessionNotification } from "@agentclientprotocol/sdk"
import path from "path"
import { Plan } from "../../../src/session/plan"
import { Bus } from "../../../src/bus"
import { Log } from "../../../src/util/log"
import { Instance } from "../../../src/project/instance"
import * as PlanTranslator from "../../../src/acp/translation/plan"

const projectRoot = path.join(__dirname, "../../..")
Log.init({ print: false })

describe("Plan translation", () => {
  test("should extract plan entries from ACP notification", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const sessionID = "test-session-" + Math.random().toString(36).slice(2)

        const notification: SessionNotification = {
          sessionId: sessionID,
          update: {
            sessionUpdate: "plan",
            entries: [
              {
                content: "Implement authentication",
                priority: "high",
                status: "in_progress",
              },
              {
                content: "Write tests",
                priority: "medium",
                status: "pending",
              },
            ],
          },
        }

        await PlanTranslator.handlePlan(sessionID, notification)

        const entries = await Plan.get(sessionID)
        expect(entries).toHaveLength(2)
        expect(entries[0].content).toBe("Implement authentication")
        expect(entries[0].priority).toBe("high")
        expect(entries[0].status).toBe("in_progress")
        expect(entries[1].content).toBe("Write tests")
        expect(entries[1].priority).toBe("medium")
        expect(entries[1].status).toBe("pending")
      },
    })
  })

  test("should emit plan.updated bus event", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const sessionID = "test-session-" + Math.random().toString(36).slice(2)
        let eventReceived = false
        let receivedEntries: Plan.Entry[] | undefined

        const unsub = Bus.subscribe(Plan.Event.Updated, (event) => {
          eventReceived = true
          receivedEntries = event.properties.entries
        })

        const notification: SessionNotification = {
          sessionId: sessionID,
          update: {
            sessionUpdate: "plan",
            entries: [
              {
                content: "Task 1",
                priority: "low",
                status: "completed",
              },
            ],
          },
        }

        await PlanTranslator.handlePlan(sessionID, notification)

        // Give event time to propagate
        await new Promise((resolve) => setTimeout(resolve, 100))

        unsub()

        expect(eventReceived).toBe(true)
        expect(receivedEntries).toBeDefined()
        expect(receivedEntries).toHaveLength(1)
        expect(receivedEntries![0].content).toBe("Task 1")
      },
    })
  })

  test("should handle complete replacement semantics", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const sessionID = "test-session-" + Math.random().toString(36).slice(2)

        // First plan
        const notification1: SessionNotification = {
          sessionId: sessionID,
          update: {
            sessionUpdate: "plan",
            entries: [
              {
                content: "Initial task 1",
                priority: "high",
                status: "pending",
              },
              {
                content: "Initial task 2",
                priority: "medium",
                status: "pending",
              },
            ],
          },
        }

        await PlanTranslator.handlePlan(sessionID, notification1)

        // Second plan - should completely replace first
        const notification2: SessionNotification = {
          sessionId: sessionID,
          update: {
            sessionUpdate: "plan",
            entries: [
              {
                content: "Replacement task",
                priority: "low",
                status: "completed",
              },
            ],
          },
        }

        await PlanTranslator.handlePlan(sessionID, notification2)

        const entries = await Plan.get(sessionID)
        expect(entries).toHaveLength(1)
        expect(entries[0].content).toBe("Replacement task")
      },
    })
  })

  test("should handle empty plan entries", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const sessionID = "test-session-" + Math.random().toString(36).slice(2)

        // First add some entries
        await PlanTranslator.handlePlan(sessionID, {
          sessionId: sessionID,
          update: {
            sessionUpdate: "plan",
            entries: [
              {
                content: "Task to remove",
                priority: "high",
                status: "pending",
              },
            ],
          },
        })

        // Then clear the plan
        const notification: SessionNotification = {
          sessionId: sessionID,
          update: {
            sessionUpdate: "plan",
            entries: [],
          },
        }

        await PlanTranslator.handlePlan(sessionID, notification)

        const entries = await Plan.get(sessionID)
        expect(entries).toHaveLength(0)
      },
    })
  })

  test("should skip invalid entries and log warnings", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const sessionID = "test-session-" + Math.random().toString(36).slice(2)

        const notification: SessionNotification = {
          sessionId: sessionID,
          update: {
            sessionUpdate: "plan",
            entries: [
              {
                content: "Valid task",
                priority: "high",
                status: "pending",
              },
              {
                content: "Invalid priority task",
                priority: "invalid" as any, // Invalid priority
                status: "pending",
              },
              {
                content: "Invalid status task",
                priority: "medium",
                status: "invalid" as any, // Invalid status
              },
            ],
          },
        }

        await PlanTranslator.handlePlan(sessionID, notification)

        const entries = await Plan.get(sessionID)
        // Only valid entry should be stored
        expect(entries).toHaveLength(1)
        expect(entries[0].content).toBe("Valid task")
      },
    })
  })

  test("should return early for non-plan notifications", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const sessionID = "test-session-" + Math.random().toString(36).slice(2)

        // Set initial plan
        await Plan.update({
          sessionID,
          entries: [
            {
              content: "Existing task",
              priority: "high",
              status: "pending",
            },
          ],
        })

        // Call with wrong notification type
        const notification: SessionNotification = {
          sessionId: sessionID,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text: "test",
            },
          } as any,
        }

        await PlanTranslator.handlePlan(sessionID, notification)

        // Plan should remain unchanged
        const entries = await Plan.get(sessionID)
        expect(entries).toHaveLength(1)
        expect(entries[0].content).toBe("Existing task")
      },
    })
  })
})
