/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { Context } from "@opencode/plugin/tui/context"
import { SidebarContext } from "../../src/feature-plugins/sidebar/context"
import { ConfigProvider } from "../../src/config"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { loadDictionary } from "../../src/i18n/translate"

function context(options?: { cost?: number; tokens?: number }) {
  const color = RGBA.fromInts(200, 200, 200)
  return {
    theme: { text: { default: color, subdued: color } },
    data: {
      session: {
        get: () => ({ location: { directory: "/workspace" } }),
        cost: () => options?.cost ?? 0,
        message: {
          list: () =>
            options?.tokens
              ? [
                  {
                    id: "message",
                    type: "assistant",
                    model: { providerID: "provider", id: "model" },
                    tokens: {
                      input: options.tokens,
                      output: 0,
                      reasoning: 0,
                      cache: { read: 0, write: 0 },
                    },
                  },
                ]
              : [],
        },
      },
      location: {
        model: { list: () => [] },
      },
    },
  } as unknown as Context
}

test("sidebar omits context before usage is available", async () => {
  const app = await testRender(
    () => (
      <ConfigProvider config={createTuiResolvedConfig()}>
        <SidebarContext context={context()} sessionID="session" />
      </ConfigProvider>
    ),
    {
      width: 42,
      height: 8,
    },
  )

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).not.toContain("Context")
    expect(app.captureCharFrame()).not.toContain("Not measured")
  } finally {
    app.renderer.destroy()
  }
})

test("sidebar shows available context usage", async () => {
  const app = await testRender(
    () => (
      <ConfigProvider config={createTuiResolvedConfig()}>
        <SidebarContext context={context({ tokens: 1234 })} sessionID="session" />
      </ConfigProvider>
    ),
    {
      width: 42,
      height: 8,
    },
  )

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("Context")
    expect(app.captureCharFrame()).toContain("1,234 tokens")
  } finally {
    app.renderer.destroy()
  }
})

test("sidebar formats usage and cost with the selected TUI language", async () => {
  await loadDictionary("de")
  const app = await testRender(
    () => (
      <ConfigProvider config={createTuiResolvedConfig({ language: "de" })}>
        <SidebarContext context={context({ tokens: 1234, cost: 1.25 })} sessionID="session" />
      </ConfigProvider>
    ),
    { width: 42, height: 8 },
  )

  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()
    expect(frame).toContain("1.234")
    expect(frame).toContain("1,25")
    expect(frame).not.toContain("1,234")
    expect(frame).not.toContain("$1.25")
  } finally {
    app.renderer.destroy()
  }
})
