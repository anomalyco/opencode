import { expect, test } from "bun:test"
import { gap, sentenceGap, stop } from "~/i18n/rich"

// gap and stop pick spacing and punctuation from the text's script; sentenceGap looks for a
// full-width sentence stop. Full-width ！ must count as CJK text for all three.
const cases = [
  { text: "你好！", want: { gap: "", stop: "。", sentenceGap: "" } },
  { text: "你好！ ", want: { gap: "", stop: "。", sentenceGap: "" } },
  { text: "你好", want: { gap: "", stop: "。", sentenceGap: " " } },
  { text: "Hello.", want: { gap: " ", stop: ".", sentenceGap: " " } },
  { text: "Hello", want: { gap: " ", stop: ".", sentenceGap: " " } },
]

for (const { text, want } of cases) {
  test(`${JSON.stringify(text)} picks its script's spacing and stop`, () => {
    expect(gap(text)).toBe(want.gap)
    expect(stop(text)).toBe(want.stop)
    expect(sentenceGap(text)).toBe(want.sentenceGap)
  })
}
