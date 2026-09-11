/** @jsxImportSource @opentui/solid */
import { expect, mock, test } from "bun:test"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Global } from "@opencode-ai/core/global"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { createEventSource, createFetch, directory } from "../fixture/tui-sdk"

test("aligns informational dialog content", async () => {
  const setup = await createTestRenderer({ width: 100, height: 30, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const events = createEventSource()
  const calls = createFetch()
  let api: TuiPluginApi | undefined
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })

  try {
    const { run } = await import("../../src/app")
    const task = Effect.runPromise(
      run({
        url: "http://test",
        directory,
        config: createTuiResolvedConfig({ plugin_enabled: {} }),
        fetch: calls.fetch,
        events: events.source,
        args: {},
        pluginHost: {
          async start(input) {
            api = input.api
            started()
          },
          async dispose() {},
        },
      }).pipe(Effect.provide(AppNodeBuilder.build(Global.node))),
    )
    await ready
    await setup.renderOnce()

    const titleColumn = async (command: string, title: string) => {
      api?.keymap.dispatchCommand(command)
      await setup.renderOnce()
      const line = setup
        .captureCharFrame()
        .split("\n")
        .find((line) => line.includes(title))
      return line?.indexOf(title)
    }

    const title = await titleColumn("theme.switch", "Themes")
    const debug = await titleColumn("opencode.debug", "Debug")
    const status = await titleColumn("opencode.status", "Status")
    expect(title).toBeDefined()
    expect(debug).toBe(title)
    expect(status).toBe(title)

    api?.keymap.dispatchCommand("app.exit")
    await task
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    mock.restore()
  }
})
