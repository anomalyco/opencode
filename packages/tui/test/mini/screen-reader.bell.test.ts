import { afterEach, expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { RunFooter } from "../../src/mini/footer"
import { ringBell, screenReader } from "../../src/mini/screen-reader"
import { RUN_THEME_FALLBACK } from "../../src/mini/theme"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

const bell = screenReader.bell

afterEach(() => {
  screenReader.enabled = false
  screenReader.bell = bell
})

test("rings only in screen reader mode", () => {
  let rings = 0
  screenReader.bell = () => rings++
  ringBell()
  screenReader.enabled = true
  ringBell()
  expect(rings).toBe(1)
})

test("the footer rings when a turn ends or input is needed, not when the prompt returns", async () => {
  const app = await createTestRenderer({ width: 40, height: 10, screenMode: "split-footer", footerHeight: 4 })
  let rings = 0
  screenReader.bell = () => rings++
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
    tuiConfig: createTuiResolvedConfig({ screen_reader: true }),
    miniSettings: {
      current: {
        thinking: "hide",
        tools: "show",
        shell_output: "hide",
        turn_summary: "hide",
        footer: "hide",
        splash: "hide",
        work_spinner: "block-soft-slide",
        mono: true,
      },
    },
    onPermissionReply: () => {},
    onFormReply: () => {},
    onFormCancel: () => {},
    onEditorOpen: async () => undefined,
    subscribeThemeSignal: () => () => {},
  })
  try {
    footer.event({ type: "turn.idle" })
    expect(rings).toBe(1)
    footer.event({
      type: "stream.view",
      view: { type: "permission", request: { id: "per_bell", sessionID: "ses_bell", action: "shell", resources: ["ls"], save: [] } },
    })
    expect(rings).toBe(2)
    footer.event({ type: "stream.view", view: { type: "prompt" } })
    expect(rings).toBe(2)
  } finally {
    footer.destroy()
    app.renderer.destroy()
  }
})
