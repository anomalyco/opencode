import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { RunFooter } from "../../src/mini/footer"
import { SESSION_ACTIONS } from "../../src/mini/session-actions"
import { RUN_THEME_FALLBACK } from "../../src/mini/theme"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

async function mount() {
  const app = await createTestRenderer({
    width: 60,
    height: 16,
    screenMode: "split-footer",
    footerHeight: 8,
    kittyKeyboard: true,
  })
  const footer = new RunFooter(app.renderer, {
    directory: () => "/project",
    findFiles: async () => [],
    agents: [],
    references: [],
    agent: undefined,
    modelLabel: "GPT-5",
    model: undefined,
    variant: undefined,
    first: false,
    theme: RUN_THEME_FALLBACK,
    tuiConfig: createTuiResolvedConfig(),
    actions: SESSION_ACTIONS,
    miniSettings: {
      current: {
        thinking: "hide",
        tools: "show",
        shell_output: "hide",
        turn_summary: "hide",
        footer: "show",
        splash: "hide",
        work_spinner: "block-soft-slide",
        mono: false,
      },
    },
    onPermissionReply: () => {},
    onFormReply: () => {},
    onFormCancel: () => {},
    onEditorOpen: async () => undefined,
    subscribeThemeSignal: () => () => {},
  })
  const settle = async () => {
    await app.renderOnce()
    await Bun.sleep(0)
    await app.renderOnce()
    await app.renderOnce()
  }
  return { app, footer, settle }
}

test("a picker event shows the list and selecting a row calls back", async () => {
  const { app, footer, settle } = await mount()
  const chosen: string[] = []
  try {
    await settle()
    footer.event({
      type: "picker",
      picker: {
        title: "Switch session",
        empty: "No sessions found",
        load: async () => [
          { id: "ses_a", display: "Alpha", current: true },
          { id: "ses_b", display: "Beta" },
        ],
        onSelect: (id) => {
          chosen.push(id)
        },
      },
    })
    await settle()
    await settle()
    const frame = app.captureCharFrame()
    expect(frame).toContain("Switch session")
    expect(frame).toContain("Alpha")
    expect(frame).toContain("Beta")
    app.mockInput.pressArrow("down")
    await settle()
    app.mockInput.pressEnter()
    await settle()
    expect(chosen).toEqual(["ses_b"])
    expect(app.captureCharFrame()).not.toContain("Switch session")
  } finally {
    footer.destroy()
    app.renderer.destroy()
  }
})

test("the command menu lists the session actions", async () => {
  const { app, footer, settle } = await mount()
  try {
    await settle()
    app.mockInput.pressKey("p", { ctrl: true })
    await settle()
    const frame = app.captureCharFrame()
    for (const action of SESSION_ACTIONS) expect(frame).toContain(action.display)
  } finally {
    footer.destroy()
    app.renderer.destroy()
  }
})
