/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { Context } from "@opencode/plugin/tui/context"
import { ConfigProvider } from "../../src/config"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { SidebarContext } from "../../src/feature-plugins/sidebar/context"

function usage(input: number, output = 0, read = 0) {
  return { input, output, reasoning: 0, cache: { read, write: 0 } }
}

function context(options?: {
  cost?: number
  tokens?: number
  family?: Array<{ parentID?: string; tokens: ReturnType<typeof usage> }>
  experiment?: boolean
}) {
  const color = RGBA.fromInts(200, 200, 200)
  const family = options?.family
  return {
    theme: { text: { base: color, muted: color } },
    data: {
      session: {
        get: (id: string) => {
          if (!family) return { location: { directory: "/workspace" } }
          const index = id === "session" ? 0 : Number(id.replace("child-", ""))
          return {
            ...family[index],
            id,
            model: { providerID: "provider", id: "model" },
            location: { directory: "/workspace" },
          }
        },
        family: () => family?.map((_, index) => (index === 0 ? "session" : `child-${index}`)) ?? [],
        cost: () => options?.cost ?? 0,
        message: {
          list: () =>
            options?.tokens
              ? [
                  {
                    id: "message",
                    type: "assistant",
                    model: { providerID: "provider", id: "model" },
                    tokens: usage(options.tokens),
                  },
                ]
              : [],
        },
      },
      location: {
        model: {
          list: () => [
            {
              providerID: "provider",
              id: "model",
              cost: [{ input: 3, output: 15, cache: { read: 0.3, write: 0 } }],
              limit: { context: 0 },
            },
          ],
        },
      },
    },
    experiment: options?.experiment,
  }
}

async function render(raw: ReturnType<typeof context>, sessionID = "session") {
  return testRender(
    () => (
      <ConfigProvider config={createTuiResolvedConfig({ experimental: { "cost-estimate": raw.experiment === true } })}>
        <SidebarContext context={raw as unknown as Context} sessionID={sessionID} />
      </ConfigProvider>
    ),
    { width: 42, height: 8 },
  )
}

test("sidebar omits context before usage is available", async () => {
  const app = await render(context())

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).not.toContain("Context")
    expect(app.captureCharFrame()).not.toContain("Not measured")
  } finally {
    app.renderer.destroy()
  }
})

test("sidebar shows available context usage", async () => {
  const app = await render(context({ tokens: 1234 }))

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("Context")
    expect(app.captureCharFrame()).toContain("1,234 tokens")
  } finally {
    app.renderer.destroy()
  }
})

test("sidebar estimates spend from catalog prices when the provider reports $0", async () => {
  const app = await render(
    context({
      experiment: true,
      family: [{ tokens: usage(1_000_000, 100_000, 2_000_000) }, { parentID: "session", tokens: usage(0, 10_000) }],
    }),
  )

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("≈ $5.25 spent")
  } finally {
    app.renderer.destroy()
  }
})

test("sidebar keeps the reported cost over the estimate", async () => {
  const app = await render(context({ experiment: true, cost: 1, family: [{ tokens: usage(1_000_000) }] }))

  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()
    expect(frame).toContain("$1.00 spent")
    expect(frame).not.toContain("≈")
  } finally {
    app.renderer.destroy()
  }
})

test("sidebar estimates only the selected child's usage", async () => {
  const app = await render(
    context({
      experiment: true,
      family: [
        { tokens: usage(1_000_000) },
        { parentID: "session", tokens: usage(500_000) },
        { parentID: "session", tokens: usage(2_000_000) },
      ],
    }),
    "child-1",
  )

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("≈ $1.50 spent")
  } finally {
    app.renderer.destroy()
  }
})

test("sidebar hides the estimate while the experiment is off", async () => {
  const app = await render(context({ family: [{ tokens: usage(1_000_000) }] }))

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).not.toContain("spent")
  } finally {
    app.renderer.destroy()
  }
})
