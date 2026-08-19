/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { BoxRenderable, RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { Context } from "@opencode-ai/plugin/tui/context"
import { PromptFooter } from "../../src/feature-plugins/prompt/footer"

test("prompt footer separates simultaneous subagent, shell, and usage status", async () => {
  const color = RGBA.fromInts(200, 200, 200)
  const focused = RGBA.fromInts(40, 40, 40)
  const dispatched: string[] = []
  const context = {
    location: { directory: "/workspace" },
    theme: {
      text: {
        default: color,
        subdued: color,
        action: { primary: { default: color, focused: color } },
      },
      background: { action: { primary: { default: RGBA.fromInts(0, 0, 0, 0), focused } } },
    },
    keymap: {
      shortcuts: (id: string) =>
        id === "session.child.first" ? ["ctrl+j"] : id === "command.palette.show" ? ["ctrl+p"] : [],
      dispatch: (id: string) => dispatched.push(id),
    },
    data: {
      session: {
        family: () => ["session", "child"],
        status: (id: string) => (id === "child" ? "running" : "idle"),
        get: () => ({ id: "session", location: { directory: "/workspace" } }),
        cost: () => 1,
        message: { list: () => [] },
      },
      shell: {
        list: () => [{ metadata: { sessionID: "session" } }],
      },
      location: {
        model: { list: () => [] },
      },
    },
  } as unknown as Context
  const app = await testRender(() => <PromptFooter context={context} sessionID="session" mode="normal" />, {
    width: 80,
    height: 2,
  })

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("ctrl+j 1 subagent · 1 shell · $1.00")
    expect(app.captureCharFrame()).toContain("ctrl+p commands")

    await app.mockMouse.moveTo(2, 0)
    const live = app.renderer.root.getChildren()[0]?.getChildren()[0]
    expect(live).toBeInstanceOf(BoxRenderable)
    expect((live as BoxRenderable).backgroundColor.toInts()).toEqual(focused.toInts())

    await app.mockMouse.click(2, 0)
    expect(dispatched).toEqual(["session.child.first"])
  } finally {
    app.renderer.destroy()
  }
})
