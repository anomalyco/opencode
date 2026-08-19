/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { TextareaRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { promptOffsetWidth, promptOnFirstRow, promptOnLastRow } from "../../src/prompt/display"

// The textarea's cursorOffset lives in a display-column space where a newline
// takes one position and a tab takes two, so neither Bun.stringWidth (newline
// and tab count as zero) nor String.length (wide characters count as one) can
// stand in for it. These tests pin promptOffsetWidth and the row predicates
// against what the real widget reports.
async function mount(width = 40) {
  let area!: TextareaRenderable
  const app = await testRender(
    () => (
      <box width={width} height={10}>
        <textarea
          width="100%"
          minHeight={1}
          maxHeight={6}
          wrapMode="word"
          ref={(next: TextareaRenderable) => (area = next)}
        />
      </box>
    ),
    { width, height: 10 },
  )
  await app.renderOnce()
  return { app, area }
}

async function endOffset(app: Awaited<ReturnType<typeof mount>>["app"], area: TextareaRenderable, text: string) {
  area.setText(text)
  await app.renderOnce()
  area.gotoBufferEnd()
  await app.renderOnce()
  return area.cursorOffset
}

test("promptOffsetWidth matches the textarea end-of-buffer offset", async () => {
  const { app, area } = await mount()

  try {
    for (const text of [
      "",
      "abc",
      "one\ntwo\nthree",
      "trailing\n",
      "\nleading",
      "a\n\nb",
      "中文",
      "中文\n中文",
      "你好世界\n第二行文字\n第三行",
      "中a文b\nc中d",
      "tab\there",
      "x\n\ty",
      "wrap ".repeat(20).trim(),
      "wrap ".repeat(20).trim() + "\nsecond line that is also quite long indeed",
    ]) {
      expect(promptOffsetWidth(text)).toBe(await endOffset(app, area, text))
    }
  } finally {
    app.renderer.destroy()
  }
})

test("promptOffsetWidth measures decomposed clusters as the widget renders them", async () => {
  const { app, area } = await mount()

  try {
    // An IME can commit hangul as separate jamo and Japanese kana as a base
    // plus a combining mark. The widget draws one character and charges its
    // width once, so the cluster has to be composed before measuring.
    for (const text of [
      "한국어",
      "한국어".normalize("NFD"),
      "가".normalize("NFD"),
      "안녕하세요 테스트입니다",
      "안녕하세요 테스트입니다".normalize("NFD"),
      "안녕하세요\n테스트입니다\n마지막",
      "안녕하세요\n테스트입니다\n마지막".normalize("NFD"),
      "が",
      "が".normalize("NFD"),
      "こんにちは".normalize("NFD"),
      "café".normalize("NFD"),
      "👨‍👩‍👧‍👦",
      "🇰🇷",
      // Jamo typed on their own stay separate characters and keep their own widths.
      "ᄀ",
      "ᅡ",
      "ㄱㅏ",
    ]) {
      expect(promptOffsetWidth(text)).toBe(await endOffset(app, area, text))
    }
  } finally {
    app.renderer.destroy()
  }
})

test("row predicates track document rows, not viewport rows", async () => {
  const { app, area } = await mount()

  try {
    // Eight logical lines against maxHeight 6, so the viewport has to scroll and
    // visualRow stops matching the document row.
    await endOffset(app, area, "l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8")
    expect(area.editorView.getTotalVirtualLineCount()).toBe(8)
    expect(area.scrollY).toBeGreaterThan(0)
    expect(promptOnLastRow(area)).toBe(true)
    expect(promptOnFirstRow(area)).toBe(false)

    area.gotoBufferHome()
    await app.renderOnce()
    expect(area.scrollY).toBe(0)
    expect(promptOnFirstRow(area)).toBe(true)
    expect(promptOnLastRow(area)).toBe(false)

    // Walk down one row at a time. The predicate must stay false for every row
    // above the last one, including the rows the viewport scrolls through where
    // visualRow no longer equals the document row.
    const scrolled: number[] = []
    for (let row = 0; row < 7; row++) {
      expect(promptOnLastRow(area)).toBe(false)
      if (area.scrollY > 0) scrolled.push(area.visualCursor.visualRow)
      area.moveCursorDown()
      await app.renderOnce()
    }
    expect(promptOnLastRow(area)).toBe(true)
    expect(scrolled.every((visualRow) => visualRow !== 7)).toBe(true)
    expect(scrolled.length).toBeGreaterThan(0)
  } finally {
    app.renderer.destroy()
  }
})

test("row predicates hold for a word-wrapped single logical line", async () => {
  const { app, area } = await mount()

  try {
    await endOffset(app, area, "这是一段很长的中文文本用来测试自动折行之后光标能不能一直走到最末尾")
    expect(area.lineCount).toBe(1)
    expect(area.editorView.getTotalVirtualLineCount()).toBeGreaterThan(1)
    expect(promptOnLastRow(area)).toBe(true)

    area.gotoBufferHome()
    await app.renderOnce()
    expect(promptOnFirstRow(area)).toBe(true)
    expect(promptOnLastRow(area)).toBe(false)
  } finally {
    app.renderer.destroy()
  }
})
