/** @jsxImportSource @opentui/solid */
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "@opencode-ai/tui/keymap"
import { resolve } from "@opencode-ai/tui/config/v1"
import { expect, test } from "bun:test"
import { createComponent, createSignal } from "solid-js"
import { RunFooterView } from "../src/mini/footer.view"
import { RUN_THEME_FALLBACK } from "../src/mini/theme"
import type { FooterState, FooterSubagentState, FooterView } from "../src/mini/types"

test("down opens subagents from an empty prompt", async () => {
  const [state] = createSignal<FooterState>({
    phase: "idle",
    status: "",
    queue: 0,
    model: "gpt-5",
    duration: "",
    usage: "",
    first: false,
    interrupt: 0,
    exit: 0,
  })
  const [view] = createSignal<FooterView>({ type: "prompt" })
  const [subagents] = createSignal<FooterSubagentState>({
    tabs: [
      {
        sessionID: "subagent-1",
        partID: "part-1",
        callID: "call-1",
        label: "Explore",
        description: "Inspect the keymap",
        status: "running",
        lastUpdatedAt: 1,
      },
    ],
    details: {},
    permissions: [],
    questions: [],
  })
  const config = resolve(
    { keybinds: { editor_open: "none", session_queued_prompts: "none" } },
    { terminalSuspend: true },
  )
  let offKeymap: (() => void) | undefined

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    offKeymap = registerOpencodeKeymap(keymap, renderer, config)

    return createComponent(OpencodeKeymapProvider, {
      keymap,
      get children() {
        return (
          <RunFooterView
            directory="/tmp"
            findFiles={async () => []}
            agents={() => []}
            references={() => []}
            commands={() => []}
            providers={() => undefined}
            currentModel={() => undefined}
            variants={() => []}
            currentVariant={() => undefined}
            state={state}
            view={view}
            subagent={subagents}
            theme={() => RUN_THEME_FALLBACK}
            tuiConfig={config}
            agent="opencode"
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
        )
      },
    })
  }

  const app = await testRender(() => <Harness />, { width: 100, height: 8, kittyKeyboard: true })
  try {
    await app.renderOnce()
    expect(app.renderer.currentFocusedEditor?.plainText).toBe("")
    app.mockInput.pressArrow("down")
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("Select subagent")
  } finally {
    app.renderer.currentFocusedRenderable?.blur()
    app.renderer.currentFocusedEditor?.blur()
    offKeymap?.()
    app.renderer.destroy()
  }
})
