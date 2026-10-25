import { afterAll, describe, expect, test } from "bun:test"
import { measureEditText, TextareaRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { mentionTriggerIndex, promptOffsetIndex, slashTriggerIndex } from "../../src/prompt/display"

// A real textarea checks the helpers against the offsets that the prompt editor shows.
const setup = await createTestRenderer({ width: 40, height: 4 })
afterAll(setup.dispose)
const area = new TextareaRenderable(setup.renderer, { width: 40, height: 4 })
setup.renderer.root.add(area)
const widthMethod = setup.renderer.widthMethod

// Each sample takes a different number of editor cells than JavaScript string widths report.
const samples = ["\f", "\0", "\x1b", "\x7f", "\x85", "\t", "中文", "e\u0301", "👨‍👩‍👧‍👦", "\n", "\r\n"]

describe("prompt display", () => {
  test.each([
    ["@", mentionTriggerIndex],
    ["/", slashTriggerIndex],
  ] as const)("places the %s trigger where the editor shows it", (trigger, find) => {
    const texts = [
      `\t${trigger}file`,
      ...samples.flatMap((sample) => [`${sample} ${trigger}x ${sample}`, `${sample}\n${trigger}x\r\n${sample}`]),
    ]
    const results = texts.map((text) => {
      area.setText(text)
      const index = text.indexOf(trigger)
      const offset = find(area.getTextRange(0, measureEditText(text.slice(0, index + 2), { widthMethod })), widthMethod)
      if (offset === undefined) return { text }
      const plain = area.plainText
      return {
        text,
        shown: area.getTextRange(offset, offset + 1),
        index: promptOffsetIndex(text, offset, widthMethod) === index,
        before: plain.slice(0, promptOffsetIndex(plain, offset, widthMethod)) === area.getTextRange(0, offset),
      }
    })
    expect(results).toEqual(texts.map((text) => ({ text, shown: trigger, index: true, before: true })))
  })

  test("ignores triggers inside a token or before whitespace", () => {
    const texts = [
      "中文@",
      "🙂@",
      "foo@bar.com",
      "中文 @src file",
      "\0@x",
      "Review /api design",
      "Review /tmp/file.ts",
      "https://opencode.ai/docs",
      "\0/x",
    ]
    expect(
      texts.filter(
        (text) => (mentionTriggerIndex(text, widthMethod) ?? slashTriggerIndex(text, widthMethod)) !== undefined,
      ),
    ).toEqual([])
  })

  test.each(["wcwidth", "unicode"] as const)("maps an offset to the last grapheme boundary under %s", (method) => {
    const measure = (value: string) => measureEditText(value, { widthMethod: method })
    const text = samples.join("a")
    const boundaries = [
      ...Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (part) => part.index),
      text.length,
    ]
    const offsets = Array.from({ length: measure(text) + 3 }, (_, offset) => offset - 1)
    expect(offsets.map((offset) => promptOffsetIndex(text, offset, method))).toEqual(
      offsets.map((offset) => boundaries.findLast((index) => measure(text.slice(0, index)) <= offset) ?? 0),
    )
  })
})
