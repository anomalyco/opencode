/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import {
  isThinkingMode,
  isThinkingVisible,
  nextThinkingMode,
  normalizeThinkingMode,
  reasoningSummary,
  thinkingModeActionTitle,
  ThinkingVisibility,
  type ThinkingMode,
} from "../../../src/context/thinking"

describe("ThinkingMode", () => {
  test("validates persisted thinking modes", () => {
    expect(isThinkingMode("show")).toBe(true)
    expect(isThinkingMode("hide")).toBe(true)
    expect(isThinkingMode("off")).toBe(true)
    expect(isThinkingMode("minimal")).toBe(false)
    expect(isThinkingMode(undefined)).toBe(false)
  })

  test("cycles through show, hide, and off", () => {
    const modes: ThinkingMode[] = ["show", "hide", "off"]
    expect(modes.map(nextThinkingMode)).toEqual(["hide", "off", "show"])
  })

  test("only shows reasoning outside off mode", () => {
    expect(isThinkingVisible("show")).toBe(true)
    expect(isThinkingVisible("hide")).toBe(true)
    expect(isThinkingVisible("off")).toBe(false)
  })

  test("normalizes persisted modes without changing existing values", () => {
    expect(normalizeThinkingMode("show")).toBe("show")
    expect(normalizeThinkingMode("hide")).toBe("hide")
    expect(normalizeThinkingMode("off")).toBe("off")
    expect(normalizeThinkingMode("minimal")).toBe("hide")
    expect(normalizeThinkingMode("invalid")).toBe("hide")
  })

  test("describes the next toggle action", () => {
    expect(thinkingModeActionTitle("show")).toBe("Collapse thinking")
    expect(thinkingModeActionTitle("hide")).toBe("Hide thinking")
    expect(thinkingModeActionTitle("off")).toBe("Show thinking")
  })

  test("removes all reasoning renderables and spacing in off mode", async () => {
    const [mode, setMode] = createSignal<ThinkingMode>("show")
    const app = await testRender(
      () => (
        <box flexDirection="column">
          <text>before</text>
          <ThinkingVisibility mode={mode}>
            <box marginTop={1} flexDirection="column">
              <text>Thinking: live</text>
              <text>Thought: complete</text>
              <text>Thought: opaque</text>
            </box>
          </ThinkingVisibility>
          <text>after</text>
        </box>
      ),
      { width: 30, height: 6 },
    )

    const lines = () =>
      app
        .captureCharFrame()
        .trimEnd()
        .split("\n")
        .map((line) => line.trimEnd())

    try {
      await app.renderOnce()
      expect(lines()).toContain("Thought: complete")

      setMode("hide")
      await app.renderOnce()
      expect(lines()).toContain("Thought: complete")

      setMode("off")
      await app.renderOnce()
      expect(lines()).toEqual(["before", "after"])

      setMode("show")
      await app.renderOnce()
      expect(lines()).toContain("Thought: complete")
    } finally {
      app.renderer.destroy()
    }
  })
})

describe("reasoningSummary", () => {
  test("extracts a leading summary title and leaves markdown body", () => {
    expect(reasoningSummary("**Continuing Quality Review**\n\nDetails.\n\n**Next section**\n\nMore.")).toEqual({
      title: "Continuing Quality Review",
      body: "Details.\n\n**Next section**\n\nMore.",
    })
  })

  test("extracts a completed title before its streamed body arrives", () => {
    expect(reasoningSummary("**Continuing Quality Review**")).toEqual({
      title: "Continuing Quality Review",
      body: "",
    })
  })

  test("preserves markdown-significant indentation in the extracted body", () => {
    expect(reasoningSummary("**Continuing Quality Review**\n\n    const value = true\n")).toEqual({
      title: "Continuing Quality Review",
      body: "    const value = true",
    })
  })

  test("does not consume ordinary leading bold content", () => {
    expect(reasoningSummary("**Important:** keep this in the body.")).toEqual({
      title: null,
      body: "**Important:** keep this in the body.",
    })
  })

  test("leaves content without a leading title in its body", () => {
    expect(reasoningSummary("Details only.")).toEqual({ title: null, body: "Details only." })
  })
})
