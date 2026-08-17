import measure from "string-width"
import stripAnsi from "strip-ansi"
import { eastAsianWidth } from "get-east-asian-width"

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })
const textEmoji = /^\p{Emoji}\p{Mark}*$/u
const emojiPresentation = /^\p{Emoji_Presentation}/u

export function stringWidth(value: string) {
  return Array.from(graphemes.segment(stripAnsi(value))).reduce((total, part) => {
    const width = measure(part.segment)
    const codePoint = part.segment.codePointAt(0)
    if (
      width !== 2 ||
      codePoint === undefined ||
      eastAsianWidth(codePoint) === 2 ||
      !textEmoji.test(part.segment) ||
      emojiPresentation.test(part.segment) ||
      part.segment.includes("\uFE0F") ||
      part.segment.includes("\u20E3") ||
      part.segment.includes("\u200D")
    )
      return total + width
    return total + 1
  }, 0)
}
