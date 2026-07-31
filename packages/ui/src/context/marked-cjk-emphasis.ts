import type { MarkedExtension, Tokens } from "marked"

const strongPattern = /^\*\*(?!\*)([\s\S]+?)\*\*(?!\*)/
const emPattern = /^\*(?!\*)([\s\S]+?)\*(?!\*)/

function inner(text: string | undefined) {
  if (!text) return
  const head = text[0]!
  const tail = text.at(-1)!
  if (/\s/.test(head) || /\s/.test(tail)) return
  if (head === "*" || tail === "*") return
  return text
}

export const markedCjkEmphasis = {
  extensions: [
    {
      name: "cjkStrong",
      level: "inline",
      start(src: string) {
        const index = src.indexOf("**")
        return index < 0 ? undefined : index
      },
      tokenizer(src: string): Tokens.Strong | undefined {
        const match = strongPattern.exec(src)
        const text = inner(match?.[1])
        if (!match || text === undefined) return
        return {
          type: "strong",
          raw: match[0],
          text,
          tokens: this.lexer.inline(text),
        }
      },
    },
    {
      name: "cjkEm",
      level: "inline",
      start(src: string) {
        const index = src.indexOf("*")
        return index < 0 ? undefined : index
      },
      tokenizer(src: string): Tokens.Em | undefined {
        const match = emPattern.exec(src)
        const text = inner(match?.[1])
        if (!match || text === undefined) return
        return {
          type: "em",
          raw: match[0],
          text,
          tokens: this.lexer.inline(text),
        }
      },
    },
  ],
} satisfies MarkedExtension
