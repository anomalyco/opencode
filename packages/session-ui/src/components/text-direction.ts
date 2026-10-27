// Letters decide direction; digits, punctuation and whitespace are neutral.
const letter = /\p{L}/gu

// Scripts written right to left. A letter in any other script reads left to right.
const rightToLeft = /(?=[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Mandaic}\p{Script=Adlam}])\p{L}/gu

/**
 * `dir="auto"` resolves from the first strong character, which flips a mostly
 * Arabic text that opens with an identifier such as "React". Counting the
 * scripts and keeping the majority holds the text in the language it is mostly
 * written in. Counting every letter rather than a list of left-to-right scripts
 * keeps Chinese, Japanese, Korean, Devanagari and other left-to-right writing
 * systems left to right when a single right-to-left word appears.
 */
export function textDirection(text: string) {
  const letters = text.match(letter)?.length ?? 0
  const rtl = text.match(rightToLeft)?.length ?? 0
  const ltr = letters - rtl

  if (rtl === ltr) return

  return rtl > ltr ? "rtl" : "ltr"
}
