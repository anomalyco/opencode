/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { Context } from "@opencode/plugin/tui/context"
import { SidebarBackground } from "../../src/feature-plugins/sidebar/background"

const assistant = (id: string, created: number, completed: number | undefined, tokens: number, content: unknown[] = []) => ({
  id,
  type: "assistant",
  time: { created, completed },
  tokens: { input: 0, output: tokens, reasoning: 0, cache: { read: 0, write: 0 } },
  content,
})

const subagent = (id: string, sessionID: string, status: string, description: string, agent: string) => ({
  type: "tool",
  id,
  name: "subagent",
  time: { created: 1500 },
  state: { status: "completed", input: { description, agent }, metadata: { sessionID, status } },
})

function context(options?: { sessionID?: string; status?: Record<string, string> }) {
  const color = RGBA.fromInts(200, 200, 200)
  const navigated: Array<{ type: string; sessionID: string }> = []
  const messages: Record<string, unknown[]> = {
    root: [
      assistant("m1", 1000, 2000, 150, [
        subagent("p1", "child", "running", "Explore repo", "explore"),
        subagent("p2", "done", "completed", "Finished task", "general"),
      ]),
    ],
    child: [assistant("c1", 1600, 1800, 15)],
    done: [assistant("d1", 1600, 1700, 5)],
  }
  return {
    navigated,
    context: {
      theme: {
        text: { base: color, muted: color, feedback: { success: { base: color } } },
        background: { raised: { high: color } },
      },
      data: {
        session: {
          root: (id: string) => (id === "child" ? "root" : id),
          get: (id: string) => ({ id, title: id === "root" ? "Main session" : "Child session", time: { created: 1000 } }),
          status: (id: string) => options?.status?.[id] ?? "idle",
          message: { list: (id: string) => messages[id] ?? [] },
        },
      },
      ui: { router: { navigate: (destination: { type: string; sessionID: string }) => navigated.push(destination) } },
    } as unknown as Context,
  }
}

test("sidebar lists the pinned main row and background subagents", async () => {
  const { context: ctx } = context()
  const app = await testRender(() => <SidebarBackground context={ctx} sessionID="root" />, {
    width: 60,
    height: 10,
  })

  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()
    expect(frame).toContain("Agents")
    expect(frame).toContain("Main session")
    expect(frame).toContain("main")
    expect(frame).toContain("150")
    expect(frame).toContain("Explore repo")
    expect(frame).toContain("explore")
    expect(frame).toContain("15")
    expect(frame).not.toContain("Finished task")
  } finally {
    app.renderer.destroy()
  }
})

test("sidebar resolves the root session from a subagent view", async () => {
  const { context: ctx } = context()
  const app = await testRender(() => <SidebarBackground context={ctx} sessionID="child" />, {
    width: 60,
    height: 10,
  })

  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()
    expect(frame).toContain("Main session")
    expect(frame).toContain("Explore repo")
  } finally {
    app.renderer.destroy()
  }
})

test("clicking a row navigates to that session", async () => {
  const { context: ctx, navigated } = context()
  const app = await testRender(() => <SidebarBackground context={ctx} sessionID="root" />, {
    width: 60,
    height: 10,
  })

  try {
    await app.renderOnce()
    await app.mockMouse.click(2, 1)
    expect(navigated).toEqual([{ type: "session", sessionID: "root" }])
  } finally {
    app.renderer.destroy()
  }
})
