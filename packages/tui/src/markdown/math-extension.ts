import type { MarkedExtension } from "marked"
import { latexToUnicode } from "latex2unicode"

const inlineRegex = /^\$((?:\\\$|[^$\n])+)\$/
const blockRegex = /^\$\$\n?([\s\S]+?)\n?\$\$/

/** $ 后跟数字或空白时视为货币/占位�?不做公式解析 */
function isCurrencyAhead(src: string): boolean {
  const rest = src.slice(1)
  if (rest.length === 0) return true
  if (/^\d/.test(rest)) return true
  if (/^\s/.test(rest)) return true
  return false
}

export const mathExtension: MarkedExtension[] = [
  {
    extensions: [
      {
        name: "math",
        level: "inline",
        start(src: string) {
          return src.indexOf("$")
        },
        tokenizer(src: string) {
          if (!src.startsWith("$")) return
          if (isCurrencyAhead(src)) return
          const m = inlineRegex.exec(src)
          if (!m) return
          const body = m[1].trim()
          if (!body) return
          return {
            type: "math",
            raw: m[0],
            text: latexToUnicode(body),
          }
        },
        renderer(t: any) {
          return t.text
        },
      },
      {
        name: "mathBlock",
        level: "block",
        tokenizer(src: string) {
          if (!src.startsWith("$$")) return
          const m = blockRegex.exec(src)
          if (!m) return
          const body = m[1].trim()
          if (!body) return
          return {
            type: "mathBlock",
            raw: m[0],
            text: latexToUnicode(body),
          }
        },
        renderer(t: any) {
          return t.text
        },
      },
    ],
  },
]
