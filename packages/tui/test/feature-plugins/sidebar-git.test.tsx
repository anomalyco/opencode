/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { Context } from "@opencode/plugin/tui/context"
import SidebarGitPlugin, { SidebarGit } from "../../src/feature-plugins/sidebar/git"

function context(options?: {
  files?: Array<{
    file: string
    additions: number
    deletions: number
    status: "added" | "deleted" | "modified"
    untracked?: boolean
  }>
  ahead?: number
  behind?: number
}) {
  const color = RGBA.fromInts(200, 200, 200)
  return {
    theme: {
      text: {
        base: color,
        muted: color,
        feedback: { warning: { base: color } },
      },
      diff: {
        text: {
          added: color,
          removed: color,
        },
      },
    },
    client: {
      vcs: {
        status: async () => ({ data: options?.files ?? [] }),
        get: async () => ({ data: { ahead: options?.ahead, behind: options?.behind, branch: {} } }),
      },
    },
    data: {
      session: {
        get: () => ({ location: { directory: "/workspace" } }),
      },
      on: () => () => {},
    },
  } as unknown as Context
}

test("plugin registers slot on sidebar.content", () => {
  expect(SidebarGitPlugin.id).toBe("opencode.sidebar.git")
  let registeredPath = ""
  SidebarGitPlugin.setup({
    ui: {
      slot: (config: { append?: string }) => {
        registeredPath = config.append ?? ""
      },
    },
  } as unknown as Context)
  expect(registeredPath).toBe("sidebar.content")
})

test("sidebar git omits section when tree is clean and synced", async () => {
  const app = await testRender(() => <SidebarGit context={context()} sessionID="session" />, {
    width: 42,
    height: 8,
  })

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).not.toContain("Git")
  } finally {
    app.renderer.destroy()
  }
})

test("sidebar git shows changed, untracked, sync, and line stats", async () => {
  const app = await testRender(
    () => (
      <SidebarGit
        context={context({
          files: [
            { file: "a.ts", additions: 10, deletions: 2, status: "modified" },
            { file: "b.ts", additions: 5, deletions: 0, status: "added", untracked: true },
          ],
          ahead: 1,
          behind: 2,
        })}
        sessionID="session"
      />
    ),
    {
      width: 42,
      height: 8,
    },
  )

  try {
    let frame = ""
    for (let i = 0; i < 50; i++) {
      await app.renderOnce()
      frame = app.captureCharFrame()
      if (frame.includes("Git")) break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(frame).toContain("Git")
    expect(frame).toContain("2 changed")
    expect(frame).toContain("1 untracked")
    expect(frame).toContain("1 to push")
    expect(frame).toContain("2 to pull")
    expect(frame).toContain("+15")
    expect(frame).toContain("-2")
  } finally {
    app.renderer.destroy()
  }
})
