import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { addDefaultParsers, CodeRenderable, MarkdownRenderable, type Renderable } from "@opentui/core"
import parsers from "../../../src/parsers-config"
import { ConfigProvider } from "../../../src/config"
import { ThemeProvider } from "../../../src/context/theme"
import { ReasoningBody } from "../../../src/routes/session/message-parts"
import { createTimelineAnchors } from "../../../src/routes/session/anchors"
import { context } from "../../../src/routes/session/render-context"
import { emptyThemeSource } from "../../fixture/fixture"
import { waitForHighlightedFrame } from "../../fixture/frame"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

const thought = "## Plan\n\n| step | risk |\n| --- | --- |\n| check | low |\n\n```ts\nconst probe = 1\n```"

function kinds(node: Renderable): string[] {
  const own =
    node instanceof MarkdownRenderable ? ["markdown"] : node instanceof CodeRenderable ? [`code:${node.filetype}`] : []
  return [...own, ...node.getChildren().flatMap((child) => kinds(child as Renderable))]
}

test("reasoning follows the markdown setting, also when it changes", async () => {
  addDefaultParsers(parsers.parsers)
  const [mode, setMode] = createSignal<"source" | "rendered">("rendered")
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
                thinkingMode: () => "show",
                markdownMode: mode,
                groupExploration: () => true,
                legacyTurns: () => false,
                diffWrapMode: () => "word",
                models: () => [],
                messageIndex: () => undefined,
                config,
                mutatePending: async () => true,
                pendingDelivery: () => undefined,
              }}
            >
              <ReasoningBody content={thought} streaming={false} sourceStreaming={false} />
            </context.Provider>
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 60, height: 20 },
  )
  try {
    app.renderer.start()
    // Rendered: native Markdown, as answers draw it (grid table, concealed heading and fence markers).
    // Source: the highlighted Markdown source in a code view. Each row switches the setting at runtime.
    for (const [setting, view, shown, hidden] of [
      ["rendered", ["markdown"], ["┌", "│ check ", "Plan", "const probe = 1"], ["## Plan", "| --- |", "```"]],
      ["source", ["code:markdown"], ["## Plan", "| --- | --- |", "```ts", "const probe = 1"], ["┌"]],
      ["rendered", ["markdown"], ["┌", "check"], ["## Plan", "```"]],
    ] as const) {
      setMode(setting)
      const frame = await waitForHighlightedFrame(app, (frame) => shown.every((text) => frame.includes(text)))
      expect(kinds(app.renderer.root).filter((kind) => kind === "markdown" || kind === "code:markdown")).toEqual([
        ...view,
      ])
      for (const text of hidden) expect(frame).not.toContain(text)
    }
  } finally {
    app.renderer.destroy()
  }
})
