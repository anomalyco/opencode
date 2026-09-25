// Curated Thai corpus shared by the Thai rendering and typing test suites.
//
// Thai stresses terminal text handling differently from CJK or emoji:
//   - Combining vowels (above/below) and tone marks are zero-width and must
//     cluster with their base consonant ("ที่" is 3 code points, 1 grapheme,
//     1 terminal cell).
//   - SARA AM ("ำ", U+0E33) is a *spacing* character (width 1) that still
//     clusters with its base ("ทำ" is one grapheme).
//   - Thai has no spaces between words, so naive space-based wrapping breaks
//     mid-cluster and can leave a combining mark stranded at a line start.
//
// Each sample names the behavior it is designed to pin down.

export const thai = {
  // Base consonant + above vowel + above tone mark: one cluster, 3 code points.
  clusterAbove: "ที่",
  // Base + below vowel + above tone: one cluster, marks stack vertically.
  clusterBelow: "ผู้",
  // Two stacked combining marks over one base in the same cell.
  doubleStack: "ปี่",
  // SARA AM is spacing (width 1) but clusters with the base.
  saraAm: "ทำ",
  saraAmWord: "กำลัง",
  // Tone mark between the base and SARA AM: still one grapheme, width 2.
  saraAmTone: "น้ำ",
  // Leading vowel is its own grapheme; the following consonant is the next one.
  leadingVowel: "เก",
  // Thanthakhat (U+0E4C) is a combining mark on the base, width 1.
  thanthakhat: "ก์",
  // Common greeting: clusters are ["ส","วั","ส","ดี","ค","รั","บ"] (7 clusters).
  greeting: "สวัสดีครับ",
  greetingFemale: "สวัสดีค่ะ",
  // Two clusters, each one cell: total display width 2, 5 code points.
  twoClusters: "ที่ดี",
  // No inter-word spaces: naive greedy wrapping will split clusters.
  noSpaces: "ภาษาไทยไม่มีช่องว่างระหว่างคำ",
  // Long single logical line for wrap stress tests.
  wrapSample: "เขียนโปรแกรมด้วยภาษาไทยในเทอร์มินัลต้องระวังสระและวรรณยุกต์ที่ซ้อนกัน",
  // Mixed direction-neutral content: Thai + Latin + CJK in one line.
  mixed: "ทดสอบ opencode ภาษาไทย mixed 中文 end",
  // Dangling tone mark with no base: broken pastes must not crash width math.
  danglingMark: "่ทดสอบ",
}

// Thai nonspacing marks: U+0E31, U+0E34-U+0E3A, U+0E47-U+0E4E.
// SARA AM (U+0E33) is intentionally excluded because it is a spacing character.
const THAI_COMBINING = /[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })

export function isThaiCombining(value: string) {
  return THAI_COMBINING.test(value)
}

export function startsWithThaiMark(value: string) {
  return /^[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/.test(value)
}

export function thaiGraphemes(value: string) {
  return [...graphemes.segment(value)].map((part) => part.segment)
}

// Orthographic inventory the display and typing suites share.
export const thaiOrthography = [
  thai.clusterAbove,
  thai.clusterBelow,
  thai.doubleStack,
  thai.saraAm,
  thai.saraAmTone,
  thai.leadingVowel,
  thai.thanthakhat,
  thai.noSpaces,
]
