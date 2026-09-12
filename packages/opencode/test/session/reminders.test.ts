import { describe, expect, test } from "bun:test"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { TODO_STALE_STEPS, todoReminder, todoStaleSteps } from "../../src/session/reminders"

function user(id: string): SessionV1.WithParts {
  return { info: { id, role: "user" }, parts: [] } as unknown as SessionV1.WithParts
}

function assistant(id: string, tools: string[]): SessionV1.WithParts {
  return {
    info: { id, role: "assistant" },
    parts: tools.map((tool, i) => ({
      id: `${id}-${i}`,
      type: "tool",
      tool,
      callID: `${id}-${i}`,
      state: { status: "completed" },
    })),
  } as unknown as SessionV1.WithParts
}

describe("SessionReminders.todoStaleSteps", () => {
  test("returns undefined without a user message", () => {
    expect(todoStaleSteps([assistant("a1", ["bash"])])).toBeUndefined()
  })

  test("is zero at the start of a turn", () => {
    expect(todoStaleSteps([user("u1")])).toBe(0)
  })

  test("counts tool-using steps since the last todowrite in the current turn", () => {
    const messages = [
      user("u1"),
      assistant("a1", ["todowrite"]),
      assistant("a2", ["bash"]),
      assistant("a3", []),
      assistant("a4", ["read", "edit"]),
    ]
    expect(todoStaleSteps(messages)).toBe(2)
  })

  test("resets when todowrite is called", () => {
    const messages = [user("u1"), assistant("a1", ["bash"]), assistant("a2", ["bash"]), assistant("a3", ["todowrite"])]
    expect(todoStaleSteps(messages)).toBe(0)
  })

  test("ignores steps from earlier turns", () => {
    const messages = [
      user("u1"),
      assistant("a1", ["bash"]),
      assistant("a2", ["bash"]),
      user("u2"),
      assistant("a3", ["bash"]),
    ]
    expect(todoStaleSteps(messages)).toBe(1)
  })

  test("reaches the reminder threshold after enough unrelated tool steps", () => {
    const messages = [user("u1"), ...Array.from({ length: TODO_STALE_STEPS }, (_, i) => assistant(`a${i}`, ["bash"]))]
    expect(todoStaleSteps(messages)).toBeGreaterThanOrEqual(TODO_STALE_STEPS)
  })
})

describe("SessionReminders.todoReminder", () => {
  test("returns nothing when every todo is closed", () => {
    expect(
      todoReminder([
        { content: "done", status: "completed", priority: "high" },
        { content: "dropped", status: "cancelled", priority: "low" },
      ]),
    ).toBeUndefined()
  })

  test("lists only open todos", () => {
    const text = todoReminder([
      { content: "done", status: "completed", priority: "high" },
      { content: "working", status: "in_progress", priority: "high" },
      { content: "later", status: "pending", priority: "low" },
    ])
    expect(text).toContain("2 open item(s)")
    expect(text).toContain("- [in_progress] working")
    expect(text).toContain("- [pending] later")
    expect(text).not.toContain("done")
  })
})
