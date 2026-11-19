/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { Context } from "@opencode/plugin/tui/context"
import { SidebarTodo } from "../../src/feature-plugins/sidebar/todo"

const color = RGBA.fromInts(200, 200, 200)

function todowrite(id: string, todos: string[]) {
  return {
    id,
    type: "assistant",
    content: [
      {
        type: "tool",
        id: `${id}-tool`,
        name: "todowrite",
        state: {
          status: "completed",
          input: { todos: todos.map((content) => ({ content, status: "pending" })) },
        },
      },
    ],
  }
}

function context(local: unknown[], fetched: unknown[], calls: { count: number }) {
  return {
    theme: { text: { base: color, muted: color, faint: color } },
    storage: {
      store: () => [{ open: true }, () => Promise.resolve()],
    },
    data: {
      session: {
        get: () => undefined,
        message: {
          list: () => local,
        },
      },
    },
    client: {
      message: {
        list: async () => {
          calls.count++
          return { data: fetched, cursor: {} }
        },
      },
    },
  } as unknown as Context
}

test("sidebar todo uses the newest todowrite from a targeted lookup when the loaded window has none", async () => {
  const calls = { count: 0 }
  // The loaded window is the newest messages, and the server answers newest first.
  const app = await testRender(
    () => (
      <SidebarTodo
        context={context(
          [{ id: "msg_window", type: "assistant", content: [] }],
          [todowrite("msg_gamma", ["Gamma task"]), todowrite("msg_alpha", ["Alpha task"])],
          calls,
        )}
        sessionID="session"
      />
    ),
    { width: 42, height: 12 },
  )

  try {
    const frame = await app.waitForFrame((frame) => frame.includes("Gamma task"))
    expect(frame).toContain("Gamma task")
    expect(frame).not.toContain("Alpha task")
    expect(calls.count).toBe(1)
  } finally {
    await app.dispose()
  }
})

test("sidebar todo renders the latest completed todowrite from the loaded window without a lookup", async () => {
  const calls = { count: 0 }
  const app = await testRender(
    () => (
      <SidebarTodo
        context={context(
          [todowrite("msg_local", ["Local task"]), todowrite("msg_newer", ["Newer local task"])],
          [todowrite("msg_remote", ["Remote task"])],
          calls,
        )}
        sessionID="session"
      />
    ),
    { width: 42, height: 12 },
  )

  try {
    const frame = await app.waitForFrame((frame) => frame.includes("Newer local task"))
    expect(frame).not.toContain("Local task")
    expect(frame).not.toContain("Remote task")
    expect(calls.count).toBe(0)
  } finally {
    await app.dispose()
  }
})
