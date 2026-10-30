import { describe, expect, mock, test } from "bun:test"
import type { TuiPluginApi, TuiPluginMeta, TuiSlotPlugin } from "@opencode-ai/plugin/tui"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect } from "effect"
import { Global } from "@opencode-ai/core/global"
import HomeTips from "../../src/feature-plugins/home/tips"
import HomeFooter from "../../src/feature-plugins/home/footer"
import { maxRows } from "../../src/component/prompt/size"
import { HomeStack } from "../../src/routes/home/stack"
import type { Info } from "../../src/config"
import { tmpdir } from "../fixture/fixture"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { createEventSource, createFetch, directory, json } from "../fixture/tui-sdk"

const sessionID = "ses_layout"
const session = {
  id: sessionID,
  title: "Layout",
  slug: sessionID,
  projectID: "proj_test",
  directory,
  version: "0.0.0-test",
  time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
}
const model = { providerID: "test", modelID: "model" }

type Options = { width: number; height: number; config?: Info; lines?: number; screen?: "home" | "session" }

// Runs the TUI on the home screen, or in a session whose turn is running, types `lines` lines and
// reads where the logo, the prompt and the footer ended up.
async function render(options: Options) {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const setup = await createTestRenderer({ width: options.width, height: options.height, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const calls = createFetch((url) => {
    if (url.pathname === "/session") return json([session])
    if (url.pathname === "/session/status") return json({ [sessionID]: { type: "busy" } })
    if (url.pathname === `/session/${sessionID}`) return json(session)
    if (url.pathname === `/session/${sessionID}/message`) return url.searchParams.has("limit") ? json([]) : json({})
    if (url.pathname === `/session/${sessionID}/todo` || url.pathname === `/session/${sessionID}/diff`) return json([])
    if (url.pathname === "/agent")
      return json([{ name: "build", mode: "primary", permission: [], options: {}, hidden: false }])
    if (url.pathname === "/config/providers")
      return json({
        providers: [
          {
            id: model.providerID,
            name: "Test",
            source: "config",
            env: [],
            options: {},
            models: { [model.modelID]: { id: model.modelID, name: "Model", providerID: model.providerID } },
          },
        ],
        default: { [model.providerID]: model.modelID },
      })
  })
  const started = Promise.withResolvers<TuiPluginApi>()
  const { run } = await import("../../src/app")
  const frame = async () => {
    await setup.renderOnce()
    await setup.renderOnce()
    return setup.captureCharFrame()
  }
  try {
    const task = Effect.runPromise(
      run({
        url: "http://test",
        directory,
        config: createTuiResolvedConfig({ plugin_enabled: {}, ...options.config }),
        fetch: calls.fetch,
        events: createEventSource().source,
        args: options.screen === "session" ? { continue: true } : {},
        pluginHost: {
          async start(input) {
            const host = input.runtime.setupSlots(input.api)
            for (const plugin of [HomeTips, HomeFooter]) {
              function register(slots: TuiSlotPlugin) {
                host.register({ ...slots, id: plugin.id })
                return plugin.id
              }
              await plugin.tui({ ...input.api, slots: { register } }, undefined, meta(plugin.id))
            }
            started.resolve(input.api)
          },
          async dispose() {},
        },
      }).pipe(
        Effect.provide(
          Global.layerWith({
            home: tmp.path,
            data: tmp.path,
            cache: tmp.path,
            config: tmp.path,
            state: tmp.path,
            tmp: tmp.path,
            bin: tmp.path,
            log: tmp.path,
            repos: tmp.path,
          }),
        ),
      ),
    )
    const api = await started.promise
    // The prompt is ready once it shows the model it will send to.
    for (let tries = 0; !(await frame()).includes("Model Test"); tries++) {
      if (tries > 1000) throw new Error("the prompt never became ready")
      await Bun.sleep(10)
    }
    if (options.lines) setup.renderer.stdin.emit("data", Buffer.from("x\n".repeat(options.lines)))
    // The layout follows measured sizes, so it takes a few frames to settle.
    let last = ""
    for (let tries = 0; tries < 50; tries++) {
      await Bun.sleep(10)
      const next = await frame()
      if (next === last) break
      last = next
    }
    api.keymap.dispatchCommand("app.exit")
    await task
    return measure(last)
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    mock.restore()
  }
}

function meta(id: string): TuiPluginMeta {
  return {
    id,
    source: "internal",
    spec: id,
    target: id,
    first_time: 0,
    last_time: 0,
    time_changed: 0,
    load_count: 1,
    fingerprint: "test",
    state: "same",
  }
}

function measure(frame: string) {
  const rows = frame.split("\n")
  const logo = rows.findIndex((row) => row.includes("█▀▀█ █▀▀█ █▀▀█"))
  const bars = rows.flatMap((row, index) => (row.trimStart().startsWith("┃") ? [index] : []))
  return {
    rows,
    logo: logo === -1 ? undefined : logo - 1,
    prompt: bars[0],
    // The bar runs down the padding, the text, the padding and the agent/model row.
    textRows: bars.length - 3,
    status: rows.findIndex((row) => row.includes("ctrl+p commands")),
    interrupt: rows.findIndex((row) => row.includes("esc interrupt")),
    footer: rows.findIndex((row) => row.includes(":main")),
  }
}

describe("home screen", () => {
  // First: the prompt keeps what was typed in it across the tests in this file.
  test("a short prompt keeps the default layout", async () => {
    const screen = await render({ width: 100, height: 40 })
    expect(screen.textRows).toBe(1)
    expect(screen.prompt - screen.logo!).toBe(4 + 1 + 1)
  }, 30_000)

  test("a prompt taller than the screen stays above the footer, one row below the top of the logo", async () => {
    const screen = await render({ width: 100, height: 30, lines: 40, config: { prompt: { max_height: 999 } } })
    expect(screen.logo).toBe(1)
    expect(screen.status).toBe(screen.footer - 2)
    // 27 rows above the footer, less the logo and the row above it, the padding and 5 rows around the text.
    expect(screen.textRows).toBe(16)
  }, 30_000)

  test("a small terminal keeps the prompt on screen at its default height", async () => {
    const screen = await render({ width: 60, height: 16, lines: 20 })
    expect(screen.logo).toBeGreaterThanOrEqual(1)
    expect(screen.status).toBe(screen.footer - 2)
  }, 30_000)

  test("on a terminal too short for the logo and a row to type in, the logo gives way", async () => {
    const screen = await render({ width: 60, height: 12, lines: 3 })
    expect(screen.logo).toBeUndefined()
    expect(screen.status).toBeLessThan(screen.footer)
  }, 30_000)
})

describe("session screen", () => {
  test("a prompt taller than the screen stays on it", async () => {
    const screen = await render({
      width: 100,
      height: 24,
      lines: 40,
      config: { prompt: { max_height: 999 } },
      screen: "session",
    })
    expect(screen.prompt).toBe(1)
    expect(screen.interrupt).toBe(24 - 2)
  }, 30_000)
})

describe("sizes", () => {
  test("the text area never grows past the space it has", () => {
    expect(maxRows({ terminalHeight: 30 })).toBe(10)
    expect(maxRows({ terminalHeight: 12 })).toBe(6)
    expect(maxRows({ configured: 999, terminalHeight: 30 })).toBe(999)
    expect(maxRows({ configured: 999, terminalHeight: 30, space: 16 })).toBe(16)
    expect(maxRows({ terminalHeight: 30, space: 4 })).toBe(4)
    expect(maxRows({ terminalHeight: 8, space: -3 })).toBe(1)
  })

  test("the gaps and the tips shrink in proportion, the gap above the logo to one row", () => {
    expect(HomeStack.stack({ height: 27, logo: 4, prompt: 7, bottom: 4 })).toEqual({
      gapAbove: 4,
      gapBelow: 1,
      bottom: 4,
    })
    expect(HomeStack.stack({ height: 27, logo: 4, prompt: 16, bottom: 4 })).toEqual({
      gapAbove: 3,
      gapBelow: 0,
      bottom: 3,
    })
    expect(HomeStack.stack({ height: 27, logo: 4, prompt: 22, bottom: 4 })).toEqual({
      gapAbove: 1,
      gapBelow: 0,
      bottom: 0,
    })
    expect(HomeStack.promptSpace({ height: 27, logo: 4, notice: 0 })).toBe(21)
    expect(HomeStack.logoFits({ height: 9, logo: 4, notice: 0 })).toBe(false)
  })
})
