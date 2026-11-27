import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { addDefaultParsers } from "@opentui/core"
import parsers from "../../../src/parsers-config"
import { ConfigProvider } from "../../../src/config"
import { ThemeProvider, useTheme } from "../../../src/context/theme"
import { ReasoningBody } from "../../../src/routes/session/message-parts"
import { createTimelineAnchors } from "../../../src/routes/session/anchors"
import { context } from "../../../src/routes/session/render-context"
import { emptyThemeSource } from "../../fixture/fixture"
import { waitForHighlightedFrame } from "../../fixture/frame"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

test("markdown table grid lines use the theme border color", async () => {
  addDefaultParsers(parsers.parsers)
  const config = createTuiResolvedConfig({ animations: false })
  const theme: { current?: ReturnType<typeof useTheme> } = {}
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={config}>
          <ThemeProvider mode="dark" source={emptyThemeSource}>
            {(() => {
              theme.current = useTheme()
              return null
            })()}
            <context.Provider
              value={{
                width: 60,
                terminal: { width: 60, height: 20 },
                sessionID: "fixture",
                anchors: createTimelineAnchors(),
                groupExpanded: () => false,
                setGroupExpanded: () => {},
                thinkingMode: () => "show",
                markdownMode: () => "rendered",
                groupExploration: () => true,
                legacyTurns: () => false,
                diffWrapMode: () => "word",
                models: () => [],
                messageIndex: () => undefined,
                config,
                mutatePending: async () => true,
                pendingDelivery: () => undefined,
                find: { pattern: () => undefined, current: () => undefined, counted: () => {}, located: () => {} },
              }}
            >
              <ReasoningBody
                content={"| name | value |\n| --- | --- |\n| alpha | 1 |"}
                streaming={false}
                sourceStreaming={false}
              />
            </context.Provider>
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 60, height: 20 },
  )
  try {
    app.renderer.start()
    await waitForHighlightedFrame(app, (frame) => frame.includes("┌") && frame.includes("alpha"))
    const corner = app
      .captureSpans()
      .lines.flatMap((line) => line.spans)
      .find((span) => span.text.includes("┌"))
    expect(corner?.fg.toInts()).toEqual(theme.current!.border.base.toInts())
  } finally {
    app.renderer.destroy()
  }
})
