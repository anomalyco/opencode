/**
 * The hero title's width in OpenTUI Mono cells (hero-title.css sizes the title as --title-chars cells of
 * 0.57em). Each user-perceived character counts as one cell, except scripts that fall back to wider
 * or narrower faces, measured in the site's fonts: CJK ideographs and kana are full width (1em, 1.7
 * cells), Hangul syllables about 1.5 cells, and Arabic letters, set in the sans stack, about 0.7.
 */
export function titleCells(text: string) {
  const cells = [...new Intl.Segmenter().segment(text)].reduce((sum, part) => sum + cellWidth(part.segment), 0)
  return Math.round(cells * 100) / 100
}

/**
 * True when the title can roll in letter by letter. Arabic letters join their neighbours and Thai
 * (like the Indic scripts) stacks marks on its base letters, so splitting them into one span per
 * character breaks the word apart.
 */
export function rollsByCharacter(text: string) {
  return !/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u0900-\u0DFF\u0E00-\u0E7F]/.test(text)
}

function cellWidth(grapheme: string) {
  if (/[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFF60\uFFE0-\uFFE6]/.test(grapheme)) return 1.7
  if (/[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/.test(grapheme)) return 1.5
  if (/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(grapheme)) return 0.7
  return 1
}
