import { describe, expect, test } from "bun:test"
import { type OptimizedBuffer, RGBA } from "@opentui/core"
import fs from "node:fs/promises"
import path from "node:path"
import type { PromptBarAnimationPlugin } from "../../../src/cli/cmd/tui/util/prompt-bar-animation-plugin"
import {
  DEFAULT_PROMPT_BAR_ANIMATION_PLUGIN,
  listPromptBarAnimationPlugins,
  loadPromptBarAnimationPlugins,
  resolvePromptBarAnimationBackground,
  resolvePromptBarAnimationPlugin,
} from "../../../src/cli/cmd/tui/util/prompt-bar-animation-registry"
import type { PromptBarVisualTheme } from "../../../src/cli/cmd/tui/util/prompt-bar-visual"
import { tmpdir } from "../../fixture/fixture"
import { resolvePromptBarRippleConfig } from "../../../src/cli/cmd/tui/util/prompt-bar-ripple"

const theme: PromptBarVisualTheme = {
  primary: RGBA.fromInts(1, 1, 1, 255),
  secondary: RGBA.fromInts(2, 2, 2, 255),
  accent: RGBA.fromInts(3, 3, 3, 255),
  info: RGBA.fromInts(4, 4, 4, 255),
  success: RGBA.fromInts(5, 5, 5, 255),
  warning: RGBA.fromInts(6, 6, 6, 255),
  error: RGBA.fromInts(7, 7, 7, 255),
}

describe("prompt bar animation registry", () => {
  test("falls back to legacy plugin for unknown plugin id", () => {
    const selected = resolvePromptBarAnimationPlugin("missing-plugin")
    expect(selected.id).toBe(DEFAULT_PROMPT_BAR_ANIMATION_PLUGIN)
  })

  test("state-static plugin disables idle color cycling", () => {
    const plugin = resolvePromptBarAnimationPlugin("state-static")
    expect(
      plugin.resolve({
        state: "idle",
        hasContent: false,
        idleCycleIndex: 4,
        idleCycleEnabled: true,
        theme,
      }),
    ).toBeUndefined()
  })

  test("legacy plugin still cycles idle colors", () => {
    const plugin = resolvePromptBarAnimationPlugin(DEFAULT_PROMPT_BAR_ANIMATION_PLUGIN)
    expect(
      plugin.resolve({
        state: "idle",
        hasContent: false,
        idleCycleIndex: 2,
        idleCycleEnabled: true,
        theme,
      }),
    ).toEqual(theme.accent)
  })

  test("theme-wave plugin provides alternate animated palette", () => {
    const plugin = resolvePromptBarAnimationPlugin("theme-wave")
    expect(
      plugin.resolve({
        state: "idle",
        hasContent: false,
        idleCycleIndex: 1,
        idleCycleEnabled: true,
        theme,
      }),
    ).toEqual(theme.info)
  })

  test("safe background resolver falls back when plugin throws", () => {
    const fallback = resolvePromptBarAnimationPlugin()
    const broken: PromptBarAnimationPlugin = {
      id: "broken",
      label: "broken",
      interval_ms: 100,
      resolve() {
        throw new Error("boom")
      },
    }
    expect(
      resolvePromptBarAnimationBackground({
        plugin: broken,
        fallback,
        data: {
          state: "streaming",
          hasContent: false,
          idleCycleIndex: 0,
          idleCycleEnabled: true,
          theme,
        },
      }),
    ).toEqual(theme.primary)
  })

  test("loads user plugin modules from prompt-bar-animations directory", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const target = path.join(dir, "prompt-bar-animations")
        await fs.mkdir(target, { recursive: true })
        await Bun.write(
          path.join(target, "community.js"),
          `
export const community = {
  id: "community-glow",
  label: "Community Glow",
  interval_ms: 250,
  resolve(input) {
    if (input.state === "idle") return input.theme.accent
    return undefined
  },
}
`,
        )
      },
    })

    await loadPromptBarAnimationPlugins({ directories: [tmp.path] })
    expect(resolvePromptBarAnimationPlugin("community-glow").id).toBe("community-glow")
    expect(listPromptBarAnimationPlugins().some((x) => x.id === "community-glow")).toBe(true)
  })

  test("diagonal-ripple plugin is registered", () => {
    const plugin = resolvePromptBarAnimationPlugin("diagonal-ripple")
    expect(plugin.id).toBe("diagonal-ripple")
    expect(plugin.render).toBeFunction()
  })

  test("diagonal-ripple resolve returns legacy colors for non-idle states", () => {
    const plugin = resolvePromptBarAnimationPlugin("diagonal-ripple")
    expect(
      plugin.resolve({
        state: "streaming",
        hasContent: false,
        idleCycleIndex: 0,
        idleCycleEnabled: true,
        theme,
      }),
    ).toEqual(theme.primary)
    expect(
      plugin.resolve({
        state: "error",
        hasContent: false,
        idleCycleIndex: 0,
        idleCycleEnabled: true,
        theme,
      }),
    ).toEqual(theme.error)
  })

  test("diagonal-ripple resolve returns undefined for idle cycling", () => {
    const plugin = resolvePromptBarAnimationPlugin("diagonal-ripple")
    expect(
      plugin.resolve({
        state: "idle",
        hasContent: false,
        idleCycleIndex: 3,
        idleCycleEnabled: true,
        theme,
      }),
    ).toBeUndefined()
  })

  test("diagonal-ripple resolve returns secondary when idle with content", () => {
    const plugin = resolvePromptBarAnimationPlugin("diagonal-ripple")
    expect(
      plugin.resolve({
        state: "idle",
        hasContent: true,
        idleCycleIndex: 0,
        idleCycleEnabled: false,
        theme,
      }),
    ).toEqual(theme.secondary)
  })

  test("diagonal-ripple render draws per-cell background colors", () => {
    const plugin = resolvePromptBarAnimationPlugin("diagonal-ripple")
    const cells: Array<{ x: number; y: number; color: RGBA }> = []
    const buffer = {
      width: 4,
      height: 2,
      fillRect(x: number, y: number, _w: number, _h: number, color: RGBA) {
        cells.push({ x, y, color })
      },
    }
    expect(plugin.render).toBeDefined()
    plugin.render?.({
      buffer: buffer as unknown as OptimizedBuffer,
      data: {
        state: "idle",
        hasContent: false,
        idleCycleIndex: 5,
        idleCycleEnabled: true,
        theme,
      },
      ripple: resolvePromptBarRippleConfig(),
    })
    expect(cells.length).toBe(8)
    const topLeft = cells.find((c) => c.x === 0 && c.y === 0)
    const bottomRight = cells.find((c) => c.x === 3 && c.y === 1)
    expect(topLeft).toBeDefined()
    expect(bottomRight).toBeDefined()
    expect(topLeft?.color).not.toEqual(bottomRight?.color)
  })

  test("diagonal-ripple render skips when idle cycle disabled", () => {
    const plugin = resolvePromptBarAnimationPlugin("diagonal-ripple")
    const cells: Array<{ x: number; y: number }> = []
    const buffer = {
      width: 4,
      height: 2,
      fillRect(x: number, y: number) {
        cells.push({ x, y })
      },
    }
    expect(plugin.render).toBeDefined()
    plugin.render?.({
      buffer: buffer as unknown as OptimizedBuffer,
      data: {
        state: "idle",
        hasContent: false,
        idleCycleIndex: 0,
        idleCycleEnabled: false,
        theme,
      },
      ripple: resolvePromptBarRippleConfig(),
    })
    expect(cells.length).toBe(0)
  })
})
