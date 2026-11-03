/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { ConfigProvider, resolve } from "../../src/config"
import { createLanguage, loadDictionary } from "../../src/i18n/translate"
import { entryBody } from "../../src/mini/entry.body"
import { RunEntryContent } from "../../src/mini/scrollback.writer"
import { toolInlineInfo } from "../../src/mini/tool"
import type { StreamCommit } from "../../src/mini/types"
import { canonicalToolPart } from "./fixture/tool-part"
import { RunSettingsBody, RUN_COMMAND_PANEL_ROWS } from "../../src/mini/footer.command"
import { RUN_THEME_FALLBACK } from "../../src/mini/theme"
import { resolveMiniSettings } from "../../src/mini/runtime.boot"
import { applyMiniSettingChange } from "../../src/mini/verbosity"

test.each([44, 100])("Mini settings use Russian at width %s", async (width) => {
  await loadDictionary("ru")
  const [settings, setSettings] = createSignal(resolveMiniSettings())
  const app = await testRender(
    () => (
      <ConfigProvider config={resolve({ language: "ru" }, { terminalSuspend: false })}>
        <RunSettingsBody
          theme={() => RUN_THEME_FALLBACK.footer}
          settings={settings}
          onClose={() => {}}
          onChange={(change) => {
            setSettings((current) => applyMiniSettingChange(current, change))
          }}
          animations={false}
        />
      </ConfigProvider>
    ),
    { width, height: RUN_COMMAND_PANEL_ROWS },
  )
  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()
    expect(frame).toContain("Настройки")
    expect(frame).toContain("По умолчанию")
    expect(frame).toContain("показывать")
    expect(frame).toContain("скрывать")
    expect(frame).not.toContain("Thinking")
    expect(frame).not.toContain("left/right change")
    app.mockInput.pressKey("ARROW_RIGHT")
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("Всё")
  } finally {
    app.renderer.destroy()
  }
})

test.each([
  [0, "0 совпадений"],
  [1, "1 совпадение"],
  [2, "2 совпадения"],
  [5, "5 совпадений"],
  [11, "11 совпадений"],
  [21, "21 совпадение"],
  [22, "22 совпадения"],
])("Mini tool summaries use Russian plural rules for %s matches", async (matches, expected) => {
  await loadDictionary("ru")
  const language = createLanguage(() => "ru")
  const part = canonicalToolPart("grep", {
    status: "completed",
    input: { pattern: "hello", path: "/workspace/src" },
    metadata: { matches },
    content: [{ type: "text", text: "" }],
  })
  const summary = toolInlineInfo(part, "/workspace", language)
  expect(summary.title).toBe("Поиск текста «hello»")
  expect(summary.description).toBe(`в src · ${expected}`)
  expect(toolInlineInfo(part, "/workspace").title).toBe('Grep "hello"')
})

test("Mini scrollback localizes structured questions and preserves the supplied answers", async () => {
  await loadDictionary("ru")
  const language = createLanguage(() => "ru")
  const commit: StreamCommit = {
    kind: "tool",
    source: "tool",
    phase: "final",
    text: "",
    tool: "question",
    toolState: "completed",
    part: canonicalToolPart("question", {
      status: "completed",
      input: { questions: [{ question: "Continue?" }, {}] },
      metadata: { answers: [["Yes"]] },
      content: [{ type: "text", text: "" }],
    }),
  }
  const options = { language }
  const app = await testRender(() => <RunEntryContent commit={commit} opts={options} />, { width: 44, height: 10 })
  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()
    expect(frame).toContain("# Вопросы")
    expect(frame).toContain("Continue?")
    expect(frame).toContain("Yes")
    expect(frame).toContain("Вопрос 2")
    expect(frame).toContain("(нет ответа)")
    expect(frame).not.toContain("# Questions")
    expect(entryBody(commit, { ...options, mono: true })).toMatchObject({
      type: "text",
      content: expect.stringContaining("# Вопросы"),
    })
  } finally {
    app.renderer.destroy()
  }
})
