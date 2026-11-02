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

const user = (id: string, created: number) => ({
  id,
  type: "user",
  time: { created },
})

function context(options?: { sessionID?: string; status?: Record<string, string>; family?: string[] }) {
  const color = RGBA.fromInts(200, 200, 200)
  const navigated: Array<{ type: string; sessionID: string }> = []
  const messages: Record<string, unknown[]> = {
    root: [user("u1", 900), assistant("m1", 1000, 2000, 150)],
    child: [assistant("c1", 1600, 1800, 15)],
    done: [assistant("d1", 1600, 1700, 5)],
  }
  const sessions: Record<string, { id: string; title: string; agent?: string; time: { created: number; updated: number } }> = {
    root: { id: "root", title: "Main session", agent: "main", time: { created: 1000, updated: 2000 } },
    child: { id: "child", title: "Explore repo", agent: "explore", time: { created: 1500, updated: 1800 } },
    done: { id: "done", title: "Finished task", agent: "general", time: { created: 1500, updated: 1700 } },
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
          family: (id: string) => options?.family ?? ["root", "child", "done"],
          get: (id: string) => sessions[id],
          status: (id: string) => options?.status?.[id] ?? "idle",
          message: { list: (id: string) => messages[id] ?? [] },
        },
      },
      ui: { router: { navigate: (destination: { type: string; sessionID: string }) => navigated.push(destination) } },
    } as unknown as Context,
  }
}

test("sidebar lists the pinned main row and every descendant once", async () => {
  const { context: ctx } = context({ status: { child: "running" } })
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
    expect(frame).toContain("Finished task")
  } finally {
    app.renderer.destroy()
  }
})

test("sidebar hides the pane when the session has no descendants", async () => {
  const { context: ctx } = context({ family: ["root"] })
  const app = await testRender(() => <SidebarBackground context={ctx} sessionID="root" />, {
    width: 60,
    height: 10,
  })

  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()
    expect(frame).not.toContain("Agents")
    expect(frame).not.toContain("Main session")
  } finally {
    app.renderer.destroy()
  }
})

test("sidebar resolves the root session from a subagent view", async () => {
  const { context: ctx } = context({ status: { child: "running" } })
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
  const { context: ctx, navigated } = context({ status: { child: "running" } })
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
