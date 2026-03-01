import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"

import { resolvePromptBarOverlay, type PromptBarVisualTheme } from "../../../src/cli/cmd/tui/util/prompt-bar-visual"

const theme: PromptBarVisualTheme = {
  primary: RGBA.fromInts(1, 1, 1, 255),
  secondary: RGBA.fromInts(2, 2, 2, 255),
  accent: RGBA.fromInts(3, 3, 3, 255),
  info: RGBA.fromInts(4, 4, 4, 255),
  success: RGBA.fromInts(5, 5, 5, 255),
  warning: RGBA.fromInts(6, 6, 6, 255),
  error: RGBA.fromInts(7, 7, 7, 255),
}

describe("resolvePromptBarOverlay", () => {
  test("maps non-idle states to theme colors", () => {
    expect(
      resolvePromptBarOverlay({
        state: "error",
        hasContent: false,
        idleCycleIndex: 0,
        idleCycleEnabled: true,
        theme,
      }),
    ).toEqual(theme.error)

    expect(
      resolvePromptBarOverlay({
        state: "warning",
        hasContent: false,
        idleCycleIndex: 0,
        idleCycleEnabled: true,
        theme,
      }),
    ).toEqual(theme.warning)

    expect(
      resolvePromptBarOverlay({
        state: "tool_running",
        hasContent: false,
        idleCycleIndex: 0,
        idleCycleEnabled: true,
        theme,
      }),
    ).toEqual(theme.info)

    expect(
      resolvePromptBarOverlay({
        state: "streaming",
        hasContent: false,
        idleCycleIndex: 0,
        idleCycleEnabled: true,
        theme,
      }),
    ).toEqual(theme.primary)

    expect(
      resolvePromptBarOverlay({
        state: "tool_result",
        hasContent: false,
        idleCycleIndex: 0,
        idleCycleEnabled: true,
        theme,
      }),
    ).toEqual(theme.success)

    expect(
      resolvePromptBarOverlay({
        state: "assistant_final",
        hasContent: false,
        idleCycleIndex: 0,
        idleCycleEnabled: true,
        theme,
      }),
    ).toEqual(theme.secondary)
  })

  test("uses secondary for idle with content", () => {
    expect(
      resolvePromptBarOverlay({
        state: "idle",
        hasContent: true,
        idleCycleIndex: 0,
        idleCycleEnabled: true,
        theme,
      }),
    ).toEqual(theme.secondary)
  })

  test("cycles palette when idle, empty, and enabled", () => {
    expect(
      resolvePromptBarOverlay({
        state: "idle",
        hasContent: false,
        idleCycleIndex: 0,
        idleCycleEnabled: true,
        theme,
      }),
    ).toEqual(theme.primary)

    expect(
      resolvePromptBarOverlay({
        state: "idle",
        hasContent: false,
        idleCycleIndex: 1,
        idleCycleEnabled: true,
        theme,
      }),
    ).toEqual(theme.secondary)

    expect(
      resolvePromptBarOverlay({
        state: "idle",
        hasContent: false,
        idleCycleIndex: 2,
        idleCycleEnabled: true,
        theme,
      }),
    ).toEqual(theme.accent)

    expect(
      resolvePromptBarOverlay({
        state: "idle",
        hasContent: false,
        idleCycleIndex: 3,
        idleCycleEnabled: true,
        theme,
      }),
    ).toEqual(theme.info)

    expect(
      resolvePromptBarOverlay({
        state: "idle",
        hasContent: false,
        idleCycleIndex: 4,
        idleCycleEnabled: true,
        theme,
      }),
    ).toEqual(theme.success)

    expect(
      resolvePromptBarOverlay({
        state: "idle",
        hasContent: false,
        idleCycleIndex: 5,
        idleCycleEnabled: true,
        theme,
      }),
    ).toEqual(theme.warning)
  })

  test("returns undefined when idle, empty, and disabled", () => {
    expect(
      resolvePromptBarOverlay({
        state: "idle",
        hasContent: false,
        idleCycleIndex: 0,
        idleCycleEnabled: false,
        theme,
      }),
    ).toBeUndefined()
  })
})
