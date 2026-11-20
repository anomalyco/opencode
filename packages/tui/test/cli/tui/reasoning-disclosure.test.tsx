import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { addDefaultParsers } from "@opentui/core"
import { createSignal } from "solid-js"
import type { SessionMessageAssistant, SessionMessageAssistantReasoning } from "@opencode/client"
import parsers from "../../../src/parsers-config"
import { ConfigProvider } from "../../../src/config"
import { ThemeProvider } from "../../../src/context/theme"
import { createTimelineAnchors } from "../../../src/routes/session/anchors"
import { ReasoningPart } from "../../../src/routes/session/message-parts"
import { context } from "../../../src/routes/session/render-context"
import { emptyThemeSource } from "../../fixture/fixture"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

test("toggles a reasoning block in show and hide modes", async () => {
  addDefaultParsers(parsers.parsers)
  const [mode, setMode] = createSignal<"show" | "hide">("show")
  const part: SessionMessageAssistantReasoning = {
    type: "reasoning",
    text: "**Inspecting stability**\n\nThe body of the thought.",
    time: { created: 0, completed: 2000 },
  }
  const message: SessionMessageAssistant = {
    id: "msg_reasoning",
    type: "assistant",
    agent: "build",
    model: { providerID: "fixture", id: "fixture" },
    time: { created: 0, completed: 2000 },
    content: [part],
  }
  const config = createTuiResolvedConfig({ animations: false })
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={config}>
          <ThemeProvider mode="dark" source={emptyThemeSource}>
            <context.Provider
              value={{
                width: 60,
                terminal: { width: 60, height: 20 },
                sessionID: "fixture",
                anchors: createTimelineAnchors(),
                groupExpanded: () => false,
                setGroupExpanded: () => {},
                thinkingMode: mode,
                markdownMode: () => "rendered",
                groupExploration: () => false,
                legacyTurns: () => false,
                diffWrapMode: () => "word",
                models: () => [],
                messageIndex: () => undefined,
                config,
                mutatePending: async () => true,
                pendingDelivery: () => undefined,
              }}
            >
              <box paddingTop={2}>
                <ReasoningPart last part={part} message={message} />
              </box>
            </context.Provider>
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 60, height: 20 },
  )
  const frame = () => app.captureCharFrame()
  const headerRow = () =>
    frame()
      .split("\n")
      .findIndex((line) => line.includes("Thought"))
  const click = async () => {
    // A double click turns into a word selection, and a selected header is
    // intentionally not a disclosure toggle.
    app.renderer.clearSelection()
    const row = headerRow()
    expect(row).toBeGreaterThan(0)
    await app.mockMouse.click(6, row)
    await app.renderOnce()
  }
  try {
    app.renderer.start()
    await app.waitForFrame((value) => value.includes("The body of the thought."))
    expect(frame()).toContain("- Thought")
    expect(frame()).toContain("Inspecting stability")

    await click()
    await app.waitForVisualIdle({ quietFrames: 3 })
    expect(frame()).not.toContain("The body of the thought.")
    expect(frame()).toContain("+ Thought: Inspecting stability")

    await click()
    await app.waitForFrame((value) => value.includes("The body of the thought."))

    setMode("hide")
    await app.waitForVisualIdle({ quietFrames: 3 })
    expect(frame()).not.toContain("The body of the thought.")
    expect(frame()).toContain("+ Thought: Inspecting stability")

    await click()
    await app.waitForFrame((value) => value.includes("The body of the thought."))

    setMode("show")
    await app.waitForFrame((value) => value.includes("The body of the thought."))
  } finally {
    app.renderer.destroy()
  }
})
