export * as Token from "./token.js"

const CHARS_PER_TOKEN = 4

// A Hangul syllable or CJK character is one UTF-16 unit but costs well over a quarter token: measured on current
// OpenAI and DeepSeek tokenizers, Hangul 0.68-0.79 and other CJK 0.62-0.75 tokens per character. Each weight sits just
// below the lowest measurement so the estimate stays an underestimate, as length / 4 is for Latin text.
const HANGUL = /[ᄀ-ᇿ㄰-㆏ꥠ-꥿가-퟿ﾠ-ￜ]+/g
const CJK = /[⺀-鿿豈-﫿︰-﹏＀-￯]+/g

export const estimate = (input: string) => {
  const nonHangul = input.replace(HANGUL, "")
  const rest = nonHangul.replace(CJK, "")
  const dense = (input.length - nonHangul.length) * 0.65 + (nonHangul.length - rest.length) * 0.6
  return Math.max(0, Math.round(dense + rest.length / CHARS_PER_TOKEN))
}
