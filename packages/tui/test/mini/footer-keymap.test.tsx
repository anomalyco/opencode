/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { Keymap } from "../../src/context/keymap"
import { resolve } from "../../src/config"
import { expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { RunFooterView } from "../../src/mini/footer.view"
import { RUN_THEME_FALLBACK } from "../../src/mini/theme"
import type { FooterState, FooterSubagentState, FooterView } from "../../src/mini/types"

test("down opens subagents from an empty prompt", async () => {
  const [state] = createSignal<FooterState>({
    phase: "idle",
    status: "",
    notice: "",
    model: "gpt-5",
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
        label: "Explore",
        description: "Inspect the keymap",
        status: "running",
      },
    ],
    details: {},
    permissions: [],
    forms: [],
  })
  const config = resolve(
    { keybinds: { editor_open: "none", session_queued_prompts: "none" } },
    { terminalSuspend: true },
  )
  function Harness() {
    return (
      <Keymap.Provider config={config}>
        <RunFooterView
          directory={() => "/tmp"}
          findFiles={async () => []}
          agents={() => []}
          references={() => []}
          commands={() => []}
          providers={() => undefined}
          currentAgent={() => "Build"}
          currentAgentID={() => "build"}
          currentModel={() => undefined}
          variants={() => []}
          currentVariant={() => undefined}
          state={state}
          view={view}
          subagent={subagents}
          theme={() => RUN_THEME_FALLBACK}
          miniSettings={() => ({ thinking: "hide", shell_output: "hide", turn_summary: "show", footer: "show", mono: false })}
          mono={false}
          onSubmit={() => true}
          onPermissionReply={() => {}}
          onFormReply={() => {}}
          onFormCancel={() => {}}
          onCycle={() => {}}
          onInterrupt={() => false}
          onEditorOpen={async () => undefined}
          onInputClear={() => {}}
          onExit={() => {}}
          onAgentSelect={() => {}}
          onModelSelect={() => {}}
          onVariantSelect={() => {}}
          onRows={() => {}}
          onLayout={() => {}}
          onStatus={() => {}}
          onMiniSettingChange={() => {}}
        />
      </Keymap.Provider>
    )
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
    app.renderer.destroy()
  }
})
