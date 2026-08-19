/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { Context } from "@opencode-ai/plugin/tui/context"
import { PromptFooter } from "../../src/feature-plugins/prompt/footer"

test("prompt footer separates simultaneous subagent, shell, and usage status", async () => {
  const color = RGBA.fromInts(200, 200, 200)
  const context = {
    location: { directory: "/workspace" },
    theme: { text: { default: color, subdued: color } },
    keymap: {
      shortcuts: (id: string) =>
        id === "session.child.first" ? ["ctrl+j"] : id === "command.palette.show" ? ["ctrl+p"] : [],
    },
    data: {
      on: () => () => {},
      session: {
        family: () => ["session", "child"],
        status: (id: string) => (id === "child" || id === "session" ? "running" : "idle"),
        get: () => ({ id: "session", location: { directory: "/workspace" } }),
        cost: () => 1,
        message: {
          list: () => [
            {
              type: "assistant",
              content: [
                {
                  type: "tool",
                  id: "call-shell",
                  state: { status: "completed", metadata: { status: "running" } },
                },
              ],
            },
          ],
        },
      },
      shell: {
        list: () => [{ metadata: { sessionID: "session", callID: "call-shell" } }],
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
  } finally {
    app.renderer.destroy()
  }
})
