import { describe, expect, test } from "bun:test"
import { TaskGraph, type TaskLevel, executeTaskLevels } from "../../../src/session/work-queue/graph"
import { MessageV2 } from "../../../src/session/message-v2"

function createSubtask(id: string, agent: string, prompt: string, dependencies: string[] = []): MessageV2.SubtaskPart {
  return {
    id,
    sessionID: "test-session",
    messageID: "test-message",
    type: "subtask",
    prompt,
    description: `Test subtask ${id}`,
    agent,
    model: {
      providerID: "test",
      modelID: "test",
    },
  }
}

describe("TaskGraph", () => {
  test("should build graph with correct levels", () => {
    const tasks = [
      createSubtask("1", "explore", "Explore the codebase"),
      createSubtask("2", "build", "Build after exploring", ["1"]),
      createSubtask("3", "test", "Test after building", ["2"]),
    ]

    const graph = new TaskGraph(tasks)
    const result = graph.buildLevels()

    expect(result.totalNodes).toBe(3)
    expect(result.levels.length).toBe(3)
    expect(result.levels[0].nodes[0].id).toBe("1")
    expect(result.levels[1].nodes[0].id).toBe("2")
    expect(result.levels[2].nodes[0].id).toBe("3")
  })

  test("should handle independent tasks at same level", () => {
    const tasks = [
      createSubtask("1", "explore", "Explore A"),
      createSubtask("2", "explore", "Explore B"),
      createSubtask("3", "build", "Build after both", ["1", "2"]),
    ]

    const graph = new TaskGraph(tasks)
    const result = graph.buildLevels()

    expect(result.totalNodes).toBe(3)
    expect(result.levels.length).toBe(2)
    expect(result.levels[0].nodes.length).toBe(2)
    expect(result.levels[1].nodes.length).toBe(1)
  })
})

describe("executeTaskLevels", () => {
  test("should execute tasks respecting dependencies", async () => {
    const executionOrder: string[] = []
    const tasks = [
      createSubtask("1", "explore", "Explore first"),
      createSubtask("2", "build", "Build after explore", ["1"]),
    ]

    const levels = new TaskGraph(tasks).buildLevels().levels

    await executeTaskLevels(
      levels,
      async (task) => {
        executionOrder.push(task.id)
      },
      2,
    )

    expect(executionOrder.length).toBe(2)
    expect(executionOrder.indexOf("1")).toBeLessThan(executionOrder.indexOf("2"))
  })

  test("should execute independent tasks in parallel", async () => {
    const executionOrder: string[] = []
    const startTimes: Record<string, number> = {}
    const tasks = [
      createSubtask("1", "explore", "Explore A"),
      createSubtask("2", "explore", "Explore B"),
      createSubtask("3", "build", "Build after both", ["1", "2"]),
    ]

    const levels = new TaskGraph(tasks).buildLevels().levels

    await executeTaskLevels(
      levels,
      async (task) => {
        const now = Date.now()
        startTimes[task.id] = now
        executionOrder.push(task.id)
        await new Promise((resolve) => setTimeout(resolve, 100))
      },
      2,
    )

    expect(executionOrder.length).toBe(3)
    expect(executionOrder[0]).toBeOneOf(["1", "2"])
    expect(executionOrder[1]).toBeOneOf(["1", "2"])
    expect(executionOrder[2]).toBe("3")
  })

  test("should respect maxParallel limit", async () => {
    const runningCount: number[] = []
    const maxConcurrent: number[] = []

    const tasks = [
      createSubtask("1", "explore", "Task 1"),
      createSubtask("2", "explore", "Task 2"),
      createSubtask("3", "explore", "Task 3"),
    ]

    const levels = new TaskGraph(tasks).buildLevels().levels

    let currentRunning = 0

    await executeTaskLevels(
      levels,
      async (task) => {
        currentRunning++
        maxConcurrent.push(currentRunning)
        runningCount.push(currentRunning)
        await new Promise((resolve) => setTimeout(resolve, 50))
        currentRunning--
      },
      2,
    )

    expect(Math.max(...maxConcurrent)).toBeLessThanOrEqual(2)
  })

  test("should handle empty levels", async () => {
    const executionOrder: string[] = []
    const emptyLevels: TaskLevel[] = []

    await executeTaskLevels(
      emptyLevels,
      async (task) => {
        executionOrder.push(task.id)
      },
      2,
    )

    expect(executionOrder.length).toBe(0)
  })

  test("should handle error in subtask without blocking others", async () => {
    const executionOrder: string[] = []
    const tasks = [
      createSubtask("1", "explore", "Task 1"),
      createSubtask("2", "build", "Task 2", ["1"]),
      createSubtask("3", "test", "Task 3"),
    ]

    const levels = new TaskGraph(tasks).buildLevels().levels

    await executeTaskLevels(
      levels,
      async (task) => {
        executionOrder.push(task.id)
        if (task.id === "2") {
          throw new Error("Task 2 failed")
        }
      },
      2,
    )

    expect(executionOrder.length).toBe(3)
    expect(executionOrder.indexOf("1")).toBeLessThan(executionOrder.indexOf("2"))
    expect(executionOrder.indexOf("3")).toBeLessThan(executionOrder.indexOf("2"))
  })
})
