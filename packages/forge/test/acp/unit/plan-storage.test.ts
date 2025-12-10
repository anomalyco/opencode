/**
 * Unit Test: Plan Storage
 *
 * Tests plan storage, retrieval, and bus event publishing
 */

import { describe, expect, test } from "bun:test"
import path from "path"
import { Plan } from "../../../src/session/plan"
import { Bus } from "../../../src/bus"
import { Log } from "../../../src/util/log"
import { Instance } from "../../../src/project/instance"

const projectRoot = path.join(__dirname, "../../..")
Log.init({ print: false })

describe("Plan storage and events", () => {
  test("should store and retrieve plan entries", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const sessionID = "test-session-" + Math.random().toString(36).slice(2)
        const entries: Plan.Entry[] = [
          {
            content: "Implement user authentication",
            priority: "high",
            status: "in_progress",
          },
          {
            content: "Write unit tests",
            priority: "medium",
            status: "pending",
          },
          {
            content: "Update documentation",
            priority: "low",
            status: "completed",
          },
        ]

        await Plan.update({ sessionID, entries })
        const retrieved = await Plan.get(sessionID)

        expect(retrieved).toEqual(entries)
      },
    })
  })

  test("should emit plan.updated event when plan is updated", async () => {
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

        const entries: Plan.Entry[] = [
          {
            content: "Create React component",
            priority: "high",
            status: "pending",
          },
        ]

        await Plan.update({ sessionID, entries })

        // Give event time to propagate
        await new Promise((resolve) => setTimeout(resolve, 100))

        unsub()

        expect(eventReceived).toBe(true)
        expect(receivedEntries).toEqual(entries)
      },
    })
  })

  test("should return empty array for non-existent session", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const sessionID = "non-existent-session-" + Math.random().toString(36).slice(2)
        const entries = await Plan.get(sessionID)

        expect(entries).toEqual([])
      },
    })
  })

  test("should handle complete replacement semantics", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const sessionID = "test-session-" + Math.random().toString(36).slice(2)

        // Initial plan
        const initialEntries: Plan.Entry[] = [
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
        ]

        await Plan.update({ sessionID, entries: initialEntries })

        // Complete replacement with different entries
        const replacementEntries: Plan.Entry[] = [
          {
            content: "New Task 1",
            priority: "low",
            status: "completed",
          },
        ]

        await Plan.update({ sessionID, entries: replacementEntries })
        const retrieved = await Plan.get(sessionID)

        expect(retrieved).toEqual(replacementEntries)
        expect(retrieved).not.toEqual(initialEntries)
        expect(retrieved.length).toBe(1)
      },
    })
  })

  test("should validate priority enum values", () => {
    const validPriorities = ["high", "medium", "low"]

    validPriorities.forEach((priority) => {
      const entry = {
        content: "Test task",
        priority: priority as "high" | "medium" | "low",
        status: "pending" as const,
      }

      const result = Plan.Entry.safeParse(entry)
      expect(result.success).toBe(true)
    })

    const invalidEntry = {
      content: "Test task",
      priority: "invalid",
      status: "pending",
    }

    const result = Plan.Entry.safeParse(invalidEntry)
    expect(result.success).toBe(false)
  })

  test("should validate status enum values", () => {
    const validStatuses = ["pending", "in_progress", "completed"]

    validStatuses.forEach((status) => {
      const entry = {
        content: "Test task",
        priority: "medium" as const,
        status: status as "pending" | "in_progress" | "completed",
      }

      const result = Plan.Entry.safeParse(entry)
      expect(result.success).toBe(true)
    })

    const invalidEntry = {
      content: "Test task",
      priority: "medium",
      status: "invalid",
    }

    const result = Plan.Entry.safeParse(invalidEntry)
    expect(result.success).toBe(false)
  })
})
