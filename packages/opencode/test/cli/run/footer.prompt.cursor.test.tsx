/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender, useRenderer } from "@opentui/solid"
import { createSignal } from "solid-js"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "@opencode-ai/tui/keymap"
import { RunFooterView } from "@/cli/cmd/run/footer.view"
import { RUN_THEME_FALLBACK } from "@/cli/cmd/run/theme"
import { promptOffsetWidth } from "@opencode-ai/tui/prompt/display"
import type { FooterState, FooterSubagentState, FooterView, RunPrompt } from "@/cli/cmd/run/types"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

const tuiConfig = createTuiResolvedConfig()

async function renderComposer(input: { history?: RunPrompt[] } = {}) {
  const [view] = createSignal<FooterView>({ type: "prompt" })
  const [subagents] = createSignal<FooterSubagentState>({ tabs: [], details: {}, permissions: [], questions: [] })
  const [state] = createSignal<FooterState>({
    phase: "idle",
    status: "",
    queue: 0,
    model: "gpt-5",
    duration: "",
    usage: "",
    first: true,
    interrupt: 0,
    exit: 0,
  })
  let offKeymap: (() => void) | undefined

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    offKeymap = registerOpencodeKeymap(keymap, renderer, tuiConfig)

    return (
      <OpencodeKeymapProvider keymap={keymap}>
        <RunFooterView
          directory="/tmp"
          findFiles={async () => []}
          agents={() => []}
          resources={() => []}
          commands={() => []}
          providers={() => undefined}
          currentModel={() => undefined}
          variants={() => []}
          currentVariant={() => undefined}
          state={state}
          view={view}
          subagent={subagents}
          theme={() => RUN_THEME_FALLBACK}
          tuiConfig={tuiConfig}
          backgroundSubagents={true}
          agent="opencode"
          history={input.history}
          onSubmit={() => true}
          onPermissionReply={() => {}}
          onQuestionReply={() => {}}
          onQuestionReject={() => {}}
          onCycle={() => {}}
          onInterrupt={() => false}
          onEditorOpen={async () => undefined}
          onInputClear={() => {}}
          onExit={() => {}}
          onModelSelect={() => {}}
          onVariantSelect={() => {}}
          onRows={() => {}}
          onLayout={() => {}}
          onStatus={() => {}}
          onQueuedRemove={async () => true}
        />
      </OpencodeKeymapProvider>
    )
  }

  const app = await testRender(
    () => (
      <box width={40} height={16}>
        <Harness />
      </box>
    ),
    { width: 40, height: 16, kittyKeyboard: true },
  )
  await app.renderOnce()

  return {
    ...app,
    area() {
      return app.renderer.currentFocusedEditor!
    },
    async press(dir: "up" | "down", times: number) {
      for (let i = 0; i < times; i++) {
        app.mockInput.pressArrow(dir)
        await app.renderOnce()
      }
    },
    cleanup() {
      app.renderer.currentFocusedRenderable?.blur()
      app.renderer.currentFocusedEditor?.blur()
      offKeymap?.()
      offKeymap = undefined
      app.renderer.destroy()
    },
  }
}

test("direct composer down arrow walks a multi-line prompt to its end", async () => {
  const app = await renderComposer()

  try {
    const area = app.area()
    area.setText("one\ntwo\nthree")
    await app.renderOnce()
    const end = promptOffsetWidth(area.plainText)

    // Middle of the second line. Each newline costs one offset position, so the
    // end offset is 13 here while Bun.stringWidth would report 11.
    area.cursorOffset = 5
    await app.renderOnce()
    await app.press("down", 1)
    expect(area.cursorOffset).toBe(9)

    await app.press("down", 3)
    expect(area.cursorOffset).toBe(end)
  } finally {
    app.cleanup()
  }
})

test("direct composer down arrow reaches the end of wide-character text", async () => {
  const app = await renderComposer()

  try {
    const area = app.area()
    area.setText("你好世界\n第二行文字\n第三行")
    await app.renderOnce()

    area.gotoBufferHome()
    await app.renderOnce()
    await app.press("down", 6)
    expect(area.cursorOffset).toBe(promptOffsetWidth(area.plainText))
  } finally {
    app.cleanup()
  }
})

test("direct composer arrows never move backwards in a scrolled prompt", async () => {
  const app = await renderComposer()

  try {
    const area = app.area()
    // Eight lines against TEXTAREA_MAX_ROWS (6) forces the viewport to scroll.
    area.setText("l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8")
    await app.renderOnce()
    area.gotoBufferHome()
    await app.renderOnce()

    const seen = [area.cursorOffset]
    for (let i = 0; i < 9; i++) {
      app.mockInput.pressArrow("down")
      await app.renderOnce()
      expect(area.cursorOffset).toBeGreaterThanOrEqual(seen[seen.length - 1])
      seen.push(area.cursorOffset)
    }
    expect(area.cursorOffset).toBe(promptOffsetWidth(area.plainText))
  } finally {
    app.cleanup()
  }
})

test("direct composer up arrow walks a multi-line prompt to its start", async () => {
  const app = await renderComposer()

  try {
    const area = app.area()
    area.setText("你好世界\n第二行文字\n第三行")
    await app.renderOnce()
    area.gotoBufferEnd()
    await app.renderOnce()

    await app.press("up", 6)
    expect(area.cursorOffset).toBe(0)
  } finally {
    app.cleanup()
  }
})

test("direct composer recalls history from the end of a multi-line draft", async () => {
  const app = await renderComposer({ history: [{ text: "older prompt", parts: [] }] })

  try {
    const area = app.area()
    area.setText("draft one\ndraft two")
    await app.renderOnce()
    area.gotoBufferEnd()
    await app.renderOnce()

    // Up walks to the top of the draft, then swaps in the history entry.
    await app.press("up", 3)
    expect(area.plainText).toBe("older prompt")

    // Down at the end of the entry restores the draft rather than stalling.
    await app.press("down", 2)
    expect(area.plainText).toBe("draft one\ndraft two")
  } finally {
    app.cleanup()
  }
})
