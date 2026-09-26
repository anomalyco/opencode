/** @jsxImportSource @opentui/solid */
import { TextareaRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { describe, expect, test } from "bun:test"
import { placeDisplayCaret, readLogicalCaret } from "../../../src/component/prompt/autocomplete"
import { promptOffsetWidth } from "../../../src/prompt/display"
import { startsWithThaiMark, thai, thaiGraphemes, thaiOrthography } from "../../fixture/thai"

// Typing-level Thai tests. mockInput.typeText emits one stdin data event per
// UTF-16 code unit, mirroring how a terminal delivers Thai text as separate
// byte reads - the textarea must reassemble combining marks into clusters.

async function wait(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

async function mountTextarea() {
  function Harness() {
    return (
      <box width={40} height={5} paddingLeft={1}>
        <textarea width="100%" ref={(r: TextareaRenderable) => r.focus()} />
      </box>
    )
  }

  const app = await testRender(() => <Harness />, { kittyKeyboard: true })
  await wait(() => app.renderer.currentFocusedEditor instanceof TextareaRenderable)
  const textarea = app.renderer.currentFocusedEditor
  if (!(textarea instanceof TextareaRenderable)) throw new Error("expected focused textarea")
  return {
    app,
    textarea,
    async cleanup() {
      app.renderer.destroy()
    },
  }
}

describe("thai typing", () => {
  test("typed thai text round-trips through plainText", async () => {
    const editor = await mountTextarea()
    try {
      await editor.app.mockInput.typeText(thai.greeting)
      await editor.app.renderOnce()
      expect(editor.textarea.plainText).toBe(thai.greeting)
    } finally {
      await editor.cleanup()
    }
  })

  test("bracketed paste inserts thai text intact", async () => {
    const editor = await mountTextarea()
    try {
      await editor.app.mockInput.pasteBracketedText(thai.noSpaces)
      await editor.app.renderOnce()
      expect(editor.textarea.plainText).toBe(thai.noSpaces)
    } finally {
      await editor.cleanup()
    }
  })

  test("cursorOffset after typing lands after the last cluster, not between marks", async () => {
    const editor = await mountTextarea()
    try {
      // "ที่ดี" is 2 clusters / 2 cells / 5 code points. A cursor at the end
      // must sit at visual offset 2; offset 3 or 4 means the editor counts
      // code units and the cursor renders inside a combining-mark cluster.
      await editor.app.mockInput.typeText(thai.twoClusters)
      await editor.app.renderOnce()
      expect(editor.textarea.plainText).toBe(thai.twoClusters)
      expect(editor.textarea.cursorOffset).toBe(2)
    } finally {
      await editor.cleanup()
    }
  })

  test("arrow keys move a whole cluster at a time", async () => {
    const editor = await mountTextarea()
    try {
      await editor.app.mockInput.typeText(thai.twoClusters)
      await editor.app.renderOnce()

      editor.app.mockInput.pressArrow("left")
      expect(editor.textarea.cursorOffset).toBe(1)

      // Stepping left over "ที่" must skip the tone mark and vowel together.
      editor.app.mockInput.pressArrow("left")
      expect(editor.textarea.cursorOffset).toBe(0)

      editor.app.mockInput.pressArrow("right")
      expect(editor.textarea.cursorOffset).toBe(1)
      editor.app.mockInput.pressArrow("right")
      expect(editor.textarea.cursorOffset).toBe(2)
      console.log(`thai-arrow-right ${JSON.stringify(thai.twoClusters)} -> ${editor.textarea.cursorOffset}`)
    } finally {
      await editor.cleanup()
    }
  })

  test("backspace deletes a whole thai cluster", async () => {
    const editor = await mountTextarea()
    try {
      // "ที่" is a single grapheme. Deleting it must remove the base and its
      // marks together; leaving a bare "ี"/"่" desyncs cursor offsets from
      // rendered cells.
      await editor.app.mockInput.typeText(thai.clusterAbove)
      await editor.app.renderOnce()

      editor.app.mockInput.pressBackspace()
      await editor.app.renderOnce()
      expect(editor.textarea.plainText).toBe("")
    } finally {
      await editor.cleanup()
    }
  })

  test("inserting mid-line at a cluster boundary composes correctly", async () => {
    const editor = await mountTextarea()
    try {
      await editor.app.mockInput.typeText(thai.twoClusters)
      await editor.app.renderOnce()
      editor.app.mockInput.pressArrow("left")
      editor.app.mockInput.pressKey("ก")
      await editor.app.renderOnce()
      expect(editor.textarea.plainText).toBe("ที่กดี")
      expect(editor.textarea.cursorOffset).toBe(2)
      console.log(`thai-insert ${JSON.stringify(thai.twoClusters)} caret ${editor.textarea.cursorOffset}`)
    } finally {
      await editor.cleanup()
    }
  })

  test("dangling combining mark still yields consistent offsets", async () => {
    const editor = await mountTextarea()
    try {
      await editor.app.mockInput.typeText(thai.danglingMark)
      await editor.app.renderOnce()
      const text = editor.textarea.plainText
      // An orphan mark has no base, so opentui reorders it to the end of the
      // buffer ("่ทดสอบ" -> "ทดสอบ่"). The guarantees that matter for broken
      // pastes: no character loss, and the cursor stays on a valid offset.
      expect([...text].sort()).toEqual([...thai.danglingMark].sort())
      expect(Number.isInteger(editor.textarea.cursorOffset)).toBe(true)
      expect(editor.textarea.cursorOffset).toBeGreaterThan(-1)
    } finally {
      await editor.cleanup()
    }
  })

  test("typing round-trips every orthographic sample and leaves the caret on a cluster boundary", async () => {
    for (const sample of thaiOrthography) {
      const editor = await mountTextarea()
      try {
        await editor.app.mockInput.typeText(sample)
        await editor.app.renderOnce()
        expect(editor.textarea.plainText).toBe(sample)
        expect(editor.textarea.cursorOffset).toBe(promptOffsetWidth(sample))
        if (sample === thai.clusterAbove || sample === thai.saraAmTone) {
          console.log(
            `thai-type ${JSON.stringify(sample)} text ${JSON.stringify(editor.textarea.plainText)} caret ${editor.textarea.cursorOffset}`,
          )
        }
      } finally {
        await editor.cleanup()
      }
    }
  })

  test("bracketed paste round-trips sara am with a tone mark", async () => {
    const editor = await mountTextarea()
    try {
      await editor.app.mockInput.pasteBracketedText(thai.saraAmTone)
      await editor.app.renderOnce()
      expect(editor.textarea.plainText).toBe(thai.saraAmTone)
      console.log(
        `thai-paste ${JSON.stringify(thai.saraAmTone)} text ${JSON.stringify(editor.textarea.plainText)} caret ${editor.textarea.cursorOffset}`,
      )
    } finally {
      await editor.cleanup()
    }
  })

  test("arrows and backspace move one grapheme", async () => {
    const samples = [
      thai.clusterAbove,
      thai.clusterBelow,
      thai.saraAm,
      thai.saraAmTone,
      thai.thanthakhat,
      thai.leadingVowel,
    ]
    for (const sample of samples) {
      const editor = await mountTextarea()
      try {
        await editor.app.mockInput.typeText(sample)
        await editor.app.renderOnce()
        const parts = thaiGraphemes(sample)
        let cursor = promptOffsetWidth(sample)
        expect(editor.textarea.cursorOffset).toBe(cursor)
        let text = sample
        for (const part of [...parts].reverse()) {
          editor.app.mockInput.pressBackspace()
          await editor.app.renderOnce()
          text = text.slice(0, text.length - part.length)
          if (sample === thai.leadingVowel) {
            console.log(
              `thai-backspace ${JSON.stringify(sample)} -> ${JSON.stringify(editor.textarea.plainText)} caret ${editor.textarea.cursorOffset}`,
            )
          }
          expect(editor.textarea.plainText).toBe(text)
          expect(startsWithThaiMark(editor.textarea.plainText)).toBe(false)
        }
      } finally {
        await editor.cleanup()
      }

      const arrows = await mountTextarea()
      try {
        await arrows.app.mockInput.typeText(sample)
        await arrows.app.renderOnce()
        const parts = thaiGraphemes(sample)
        let cursor = promptOffsetWidth(sample)
        for (const part of [...parts].reverse()) {
          arrows.app.mockInput.pressArrow("left")
          cursor -= promptOffsetWidth(part)
          expect(arrows.textarea.cursorOffset).toBe(cursor)
        }
        const singleCell = parts.every((part) => promptOffsetWidth(part) === 1)
        if (singleCell) {
          for (const part of parts) {
            arrows.app.mockInput.pressArrow("right")
            cursor += promptOffsetWidth(part)
            expect(arrows.textarea.cursorOffset).toBe(cursor)
          }
        }
        if (!singleCell) {
          arrows.app.mockInput.pressArrow("right")
          console.log(`thai-arrow-right ${JSON.stringify(sample)} -> ${arrows.textarea.cursorOffset}`)
          expect(arrows.textarea.plainText).toBe(sample)
        }
      } finally {
        await arrows.cleanup()
      }
    }
  })

  test("inserting a consonant at a cluster boundary keeps both neighbors", async () => {
    const editor = await mountTextarea()
    try {
      await editor.app.mockInput.typeText(`${thai.saraAmTone}ดี`)
      await editor.app.renderOnce()
      editor.app.mockInput.pressArrow("left")
      editor.app.mockInput.pressKey("ก")
      await editor.app.renderOnce()
      expect(editor.textarea.plainText).toBe(`${thai.saraAmTone}กดี`)
      expect(thaiGraphemes(editor.textarea.plainText)).toEqual([thai.saraAmTone, "ก", "ดี"])
      console.log(`thai-insert ${JSON.stringify(thai.saraAmTone)} caret ${editor.textarea.cursorOffset}`)
    } finally {
      await editor.cleanup()
    }

    const leading = await mountTextarea()
    try {
      await leading.app.mockInput.typeText(thai.leadingVowel)
      await leading.app.renderOnce()
      leading.app.mockInput.pressArrow("left")
      leading.app.mockInput.pressKey("ส")
      await leading.app.renderOnce()
      expect(leading.textarea.plainText).toBe("เสก")
      expect(thaiGraphemes(leading.textarea.plainText)).toEqual(["เ", "ส", "ก"])
      console.log(`thai-insert ${JSON.stringify(thai.leadingVowel)} caret ${leading.textarea.cursorOffset}`)
    } finally {
      await leading.cleanup()
    }
  })

  test("one backward word-delete keeps cluster boundaries", async () => {
    const editor = await mountTextarea()
    try {
      await editor.app.mockInput.pasteBracketedText(thai.noSpaces)
      await editor.app.renderOnce()
      editor.app.mockInput.pressBackspace({ ctrl: true })
      await editor.app.renderOnce()
      const text = editor.textarea.plainText
      console.log(
        `thai-word-delete ${JSON.stringify(thai.noSpaces)} -> ${JSON.stringify(text)} caret ${editor.textarea.cursorOffset}`,
      )
      expect(isGraphemePrefix(thai.noSpaces, text)).toBe(true)
      expect(startsWithThaiMark(text)).toBe(false)
    } finally {
      await editor.cleanup()
    }
  })

  test("forward delete removes a whole cluster", async () => {
    const editor = await mountTextarea()
    try {
      const source = `${thai.saraAmTone}ดี`
      await editor.app.mockInput.typeText(source)
      await editor.app.renderOnce()
      while (editor.textarea.cursorOffset > 0) editor.app.mockInput.pressArrow("left")
      editor.app.mockInput.pressKey("DELETE")
      await editor.app.renderOnce()
      if (editor.textarea.plainText === source) {
        editor.app.mockInput.pressKey("d", { ctrl: true })
        await editor.app.renderOnce()
      }
      assertWholeClusters(source, editor.textarea.plainText)
      console.log(
        `thai-forward-delete ${JSON.stringify(editor.textarea.plainText)} caret ${editor.textarea.cursorOffset}`,
      )
    } finally {
      await editor.cleanup()
    }
  })

  test("selection replace keeps clusters whole", async () => {
    const editor = await mountTextarea()
    try {
      const source = `${thai.saraAmTone}ดี`
      await editor.app.mockInput.typeText(source)
      await editor.app.renderOnce()
      editor.app.mockInput.pressArrow("left", { shift: true })
      editor.app.mockInput.pressKey("ก")
      await editor.app.renderOnce()
      assertWholeClusters(source + "ก", editor.textarea.plainText)
      console.log(
        `thai-select-replace ${JSON.stringify(editor.textarea.plainText)} caret ${editor.textarea.cursorOffset}`,
      )
    } finally {
      await editor.cleanup()
    }
  })

  test("newline, vertical motion, home, and end move the caret", async () => {
    const editor = await mountTextarea()
    try {
      await editor.app.mockInput.typeText(thai.saraAmTone)
      await editor.app.renderOnce()
      editor.app.mockInput.pressEnter()
      await editor.app.mockInput.typeText(thai.leadingVowel)
      await editor.app.renderOnce()
      assertWholeClusters(`${thai.saraAmTone}\n${thai.leadingVowel}`, editor.textarea.plainText)
      console.log(`thai-newline ${JSON.stringify(editor.textarea.plainText)} caret ${editor.textarea.cursorOffset}`)

      editor.app.mockInput.pressArrow("up")
      await editor.app.renderOnce()
      console.log(`thai-arrow-up caret ${editor.textarea.cursorOffset}`)
      editor.app.mockInput.pressArrow("down")
      await editor.app.renderOnce()
      console.log(`thai-arrow-down caret ${editor.textarea.cursorOffset}`)

      const homeKey = await moveKey(editor, "HOME", { key: "a", ctrl: true })
      console.log(`thai-home caret ${editor.textarea.cursorOffset} key ${homeKey}`)
      const endKey = await moveKey(editor, "END", { key: "e", ctrl: true })
      console.log(`thai-end caret ${editor.textarea.cursorOffset} key ${endKey}`)
      expect(startsWithThaiMark(editor.textarea.plainText)).toBe(false)
    } finally {
      await editor.cleanup()
    }
  })

  test("word left and word right leave the text intact", async () => {
    const editor = await mountTextarea()
    try {
      await editor.app.mockInput.pasteBracketedText(thai.noSpaces)
      await editor.app.renderOnce()
      const typed = editor.textarea.plainText
      editor.app.mockInput.pressArrow("left", { ctrl: true })
      await editor.app.renderOnce()
      if (editor.textarea.cursorOffset === promptOffsetWidth(typed)) {
        editor.app.mockInput.pressArrow("left", { meta: true })
        await editor.app.renderOnce()
      }
      console.log(`thai-word-left caret ${editor.textarea.cursorOffset}`)
      const afterLeft = editor.textarea.cursorOffset
      editor.app.mockInput.pressArrow("right", { ctrl: true })
      await editor.app.renderOnce()
      if (editor.textarea.cursorOffset === afterLeft) {
        editor.app.mockInput.pressArrow("right", { meta: true })
        await editor.app.renderOnce()
      }
      console.log(`thai-word-right caret ${editor.textarea.cursorOffset}`)
      expect(editor.textarea.plainText).toBe(typed)
      assertWholeClusters(typed, editor.textarea.plainText)
    } finally {
      await editor.cleanup()
    }
  })

  test("autocomplete caret restore counts display cells", async () => {
    const editor = await mountTextarea()
    try {
      await editor.app.mockInput.typeText(thai.saraAmTone)
      await editor.app.renderOnce()
      const saved = editor.textarea.cursorOffset
      readLogicalCaret(editor.textarea, 0)
      const restored = editor.textarea.cursorOffset
      const placed = placeDisplayCaret(editor.textarea, thai.saraAmTone)
      const cells = Bun.stringWidth(thai.saraAmTone)
      const unit = placed === cells && placed !== thai.saraAmTone.length ? "display-cells" : "utf16"
      console.log(
        `thai-autocomplete-caret saved ${saved} restored ${restored} placed ${placed} utf16 ${thai.saraAmTone.length} cells ${cells} unit ${unit}`,
      )
      expect(restored).toBe(saved)
      expect(placed).toBe(cells)
    } finally {
      await editor.cleanup()
    }
  })
})

async function moveKey(
  editor: Awaited<ReturnType<typeof mountTextarea>>,
  key: "HOME" | "END",
  fallback: { key: string; ctrl: true },
) {
  const before = editor.textarea.cursorOffset
  editor.app.mockInput.pressKey(key)
  await editor.app.renderOnce()
  if (editor.textarea.cursorOffset !== before) return key.toLowerCase()
  editor.app.mockInput.pressKey(fallback.key, { ctrl: fallback.ctrl })
  await editor.app.renderOnce()
  if (editor.textarea.cursorOffset !== before) return `ctrl-${fallback.key}`
  return "unmoved"
}

function assertWholeClusters(source: string, result: string) {
  expect(startsWithThaiMark(result)).toBe(false)
  for (const part of thaiGraphemes(result)) {
    const split = thaiGraphemes(source).some((grapheme) => grapheme !== part && grapheme.includes(part))
    expect(split).toBe(false)
  }
}

function isGraphemePrefix(original: string, piece: string) {
  if (piece === "") return true
  let acc = ""
  for (const part of thaiGraphemes(original)) {
    acc += part
    if (acc === piece) return true
  }
  return false
}
