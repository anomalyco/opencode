import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { RGBA } from "@opentui/core"
import path from "node:path"
import { coalesceProgressCommit, resolveRunAgent, RunFooter } from "../../src/mini/footer"
import { RUN_THEME_FALLBACK, RUN_THEME_FALLBACK_LIGHT, RUN_THEME_MONO } from "../../src/mini/theme"
import type { RunAgent, RunTuiConfig, StreamCommit } from "../../src/mini/types"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { tmpdir } from "../fixture/fixture"

function progress(input: Partial<StreamCommit> = {}): StreamCommit {
  return {
    kind: "tool",
    source: "tool",
    phase: "progress",
    text: "one",
    messageID: "msg_1",
    partID: "part_1",
    tool: "shell",
    toolState: "running",
    ...input,
  }
}

test("coalesces progress only within the same message and tool state", () => {
  expect(coalesceProgressCommit(progress(), progress({ messageID: "msg_2" }))).toBeUndefined()
  expect(coalesceProgressCommit(progress(), progress({ toolState: "completed" }))).toBeUndefined()
  expect(coalesceProgressCommit(progress(), progress({ text: "two", directory: "/latest" }))).toEqual(
    progress({ text: "onetwo", directory: "/latest" }),
  )
})

test("falls back only when no agent is selected", () => {
  const agents: RunAgent[] = [
    { id: "task", name: "Task", mode: "subagent", hidden: false },
    { id: "secret", name: "Secret", mode: "primary", hidden: true },
    { id: "build", name: "Build", mode: "primary", hidden: false },
    { id: "plan", name: "Plan", mode: "primary", hidden: false },
  ]

  expect(resolveRunAgent(agents, undefined)?.id).toBe("build")
  expect(resolveRunAgent(agents, "plan")?.id).toBe("plan")
  expect(resolveRunAgent(agents, "missing")).toBeUndefined()
})

async function setup(input: { mono?: boolean; theme?: RunTuiConfig["theme"] } = {}) {
  const mono = input.mono ?? true
  const app = await createTestRenderer({ width: 112, height: 24, screenMode: "split-footer", footerHeight: 4 })
  const footer = new RunFooter(app.renderer, {
    directory: () => "/project",
    findFiles: async () => [],
    agents: [{ id: "build", name: "Build", mode: "primary", hidden: false }],
    references: [],
    agent: "build",
    modelLabel: "GPT-5",
    model: undefined,
    variant: undefined,
    first: true,
    theme: mono ? RUN_THEME_MONO : RUN_THEME_FALLBACK,
    mono,
    tuiConfig: createTuiResolvedConfig({ theme: input.theme }),
    miniSettings: {
      current: { thinking: "hide", shell_output: "hide", turn_summary: "show", footer: "show", splash: "show", mono },
    },
    onPermissionReply: () => {},
    onFormReply: () => {},
    onFormCancel: () => {},
    onEditorOpen: async () => undefined,
    subscribeThemeSignal: () => () => {},
  })
  return { ...app, footer }
}

test.each([false, true])("production footer preserves wrapped input and status on resize (mono=%s)", async (mono) => {
  const app = await setup({ mono })
  try {
    await app.renderOnce()
    await app.mockInput.typeText(
      "Explain how this project is organized, then outline a small change and the checks needed to verify it. Do not modify files.",
    )
    for (const width of [56, 112, 40]) {
      app.resize(width, 24)
      await app.renderOnce()
      await app.renderOnce()
      expect(app.renderer.footerHeight).toBe(Math.min(6, app.renderer.currentFocusedEditor!.virtualLineCount) + 3)
      const frame = app.captureCharFrame()
      expect(frame.split("\n").filter((line) => line.startsWith(mono ? "| " : "┃ "))).toHaveLength(
        app.renderer.currentFocusedEditor!.virtualLineCount,
      )
      expect(app.renderer.currentFocusedEditor!.virtualLineCount).toBeGreaterThan(1)
      expect(frame).toContain("Build")
      expect(frame.includes("GPT-5")).toBe(width >= 80)
    }
  } finally {
    app.footer.destroy()
    app.renderer.destroy()
  }
})

test("explicit theme refresh reloads custom colors without a palette event", async () => {
  await using tmp = await tmpdir()
  const previous = process.env.OPENCODE_CONFIG_DIR
  process.env.OPENCODE_CONFIG_DIR = tmp.path
  const app = await setup({ mono: false, theme: { name: "mini-refresh", mode: "dark" } })
  app.renderer.getPalette = async () => {
    throw new Error("no OSC response")
  }
  try {
    await app.renderOnce()
    await app.mockInput.typeText("draft")
    for (const color of ["#123456", "#abcdef"]) {
      await Bun.write(
        path.join(tmp.path, "themes", "mini-refresh.json"),
        JSON.stringify({ version: 2, dark: { text: { default: color } } }),
      )
      await app.footer.refreshTheme()
      await app.renderOnce()
      expect(
        app
          .captureSpans()
          .lines.flatMap((line) => line.spans)
          .find((span) => span.text.includes("draft"))
          ?.fg.toInts(),
      ).toEqual(RGBA.fromHex(color).toInts())
    }
  } finally {
    app.footer.destroy()
    app.renderer.destroy()
    if (previous === undefined) delete process.env.OPENCODE_CONFIG_DIR
    else process.env.OPENCODE_CONFIG_DIR = previous
  }
})

test("system fallback follows physical mode changes when palette queries remain unavailable", async () => {
  const app = await setup({ mono: false, theme: { name: "system" } })
  app.renderer.getPalette = async () => {
    throw new Error("no OSC palette response")
  }
  try {
    await app.renderOnce()
    await app.mockInput.typeText("draft")
    expect(app.footer.currentTheme()).toBe(RUN_THEME_FALLBACK)
    await app.mockInput.pressKeys(["\x1b]10;rgb:0000/0000/0000\x07", "\x1b]11;rgb:ffff/ffff/ffff\x07"])
    expect(app.renderer.themeMode).toBe("light")
    await app.footer.refreshTheme()
    await app.flush()
    expect(app.footer.currentTheme()).toBe(RUN_THEME_FALLBACK_LIGHT)
    expect(
      app
        .captureSpans()
        .lines.flatMap((line) => line.spans)
        .find((span) => span.text.includes("draft"))
        ?.fg.toInts(),
    ).toEqual((RUN_THEME_FALLBACK_LIGHT.footer.text as RGBA).toInts())
  } finally {
    app.footer.destroy()
    app.renderer.destroy()
  }
})
