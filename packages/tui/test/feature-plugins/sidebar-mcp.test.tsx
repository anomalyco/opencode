/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { Context } from "@opencode-ai/plugin/tui/context"
import { McpSidebar } from "../../src/feature-plugins/sidebar/mcp"

function context() {
  const color = RGBA.fromInts(200, 200, 200)
  return {
    theme: {
      text: {
        default: color,
        subdued: color,
        feedback: { success: { default: color }, error: { default: color }, warning: { default: color } },
      },
    },
    data: {
      session: { get: () => ({ location: { directory: "/workspace" } }) },
      location: {
        mcp: {
          server: {
            list: () => [
              {
                name: "broken",
                status: { status: "failed", error: "<!DOCTYPE html><html><body>raw response</body></html>" },
              },
            ],
          },
        },
      },
    },
  } as unknown as Context
}

test("sidebar summarizes MCP failures without rendering error details", async () => {
  const app = await testRender(() => <McpSidebar context={context()} sessionID="session" />, {
    width: 42,
    height: 8,
  })

  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()
    expect(frame).toContain("broken Failed")
    expect(frame).not.toContain("DOCTYPE")
    expect(frame).not.toContain("raw response")
  } finally {
    app.renderer.destroy()
  }
})
