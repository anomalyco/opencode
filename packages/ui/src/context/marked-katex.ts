import katex from "katex"
import type { MarkedExtension, Tokens } from "marked"

// Display math on its own block: $$...$$ or \[...\], single or multi line. The inner
// guards stop a lazy match from bridging two expressions on one line, e.g.
// "$$a$$ and $$b$$" must fall through to the inline tokenizer instead of matching once.
const blockMathRegex = /^(?:\$\$((?:(?!\$\$)[\s\S])+?)\$\$|\\\[((?:(?!\\\])[\s\S])+?)\\\])(?:\n|$)/

// Display math inside a paragraph. $$ closes only at a boundary so "$$5 and later $$10"
// stays prose; \[...\] is unambiguous and needs no boundary.
const inlineDisplayRegex = /^(?:\$\$((?:(?!\$\$)[\s\S])+?)\$\$(?=[\s\p{P}]|$)|\\\[((?:(?!\\\])[\s\S])+?)\\\])/u

// Inline math: \(...\) or $...$. A single $ excludes unescaped $ from its body so it
// cannot bridge "$10, while $x$" into one expression, and closes only at a boundary.
const inlineMathRegex = /^(?:\\\(((?:\\.|[^\\\n])+?)\\\)|\$(?!\$)((?:\\.|[^\\$\n])+?)\$(?=[\s\p{P}]|$))/u

// A bare $ opens math only at a line start or after whitespace/an opening bracket.
// Without this, prose like "Costs 5$ or 10$" and regex literals like "/^foo$/" tokenize
// as math. See #34850, which removed $...$ support over exactly these false positives.
const openBoundaryRegex = /[\s([{]/

export const markedKatex = {
  extensions: [
    {
      name: "inlineKatex",
      level: "inline",
      start(src) {
        const parenIdx = src.indexOf("\\(")
        // Scan every $ rather than only the first, so a rejected candidate such as the
        // one in "US$10" does not hide real math later in the same text.
        let from = 0
        while (from < src.length) {
          const dollarIdx = src.indexOf("$", from)
          if (dollarIdx === -1) break
          const rest = src.slice(dollarIdx)
          const opens = dollarIdx === 0 || openBoundaryRegex.test(src.charAt(dollarIdx - 1))
          if (opens && (inlineDisplayRegex.test(rest) || inlineMathRegex.test(rest))) {
            return parenIdx === -1 ? dollarIdx : Math.min(parenIdx, dollarIdx)
          }
          from = dollarIdx + 1
        }
        return parenIdx === -1 ? undefined : parenIdx
      },
      tokenizer(src) {
        const display = src.match(inlineDisplayRegex)
        const match = display ?? src.match(inlineMathRegex)
        if (!match) return
        return {
          type: "inlineKatex",
          raw: match[0],
          text: (match[1] ?? match[2]).trim(),
          displayMode: display !== null,
        }
      },
      renderer: renderKatexToken,
    },
    {
      name: "blockKatex",
      level: "block",
      tokenizer(src) {
        const match = src.match(blockMathRegex)
        if (!match) return
        return {
          type: "blockKatex",
          raw: match[0],
          text: (match[1] ?? match[2]).trim(),
          displayMode: true,
        }
      },
      renderer: renderKatexToken,
    },
  ],
} satisfies MarkedExtension

function renderKatexToken(token: Tokens.Generic) {
  return katex.renderToString(typeof token.text === "string" ? token.text : "", {
    displayMode: token.displayMode === true,
    throwOnError: false,
  })
}
