export * as HomeStack from "./stack"

import { CHROME_ROWS } from "../../component/prompt/size"

// The home column from the top: a spacer, the gap above the logo, the logo, the gap below it,
// the update notice, the prompt with its top padding, the home_bottom block (the tips) and a
// spacer. The top spacer is empty with the prompt at the top, the bottom one at the bottom.
export const LOGO_GAP_ABOVE = 4
// The gap above the logo shrinks to this, never to nothing, when the prompt needs the room.
export const LOGO_GAP_MIN = 1
export const LOGO_GAP_BELOW = 1
export const PROMPT_PADDING_TOP = 1

// Rows the prompt may take, its own chrome included: the column less the logo with the row it
// always keeps above it, the update notice and the prompt's top padding. The gap below the logo
// and the tips give their rows up first.
export function promptSpace(input: { height: number; logo: number; notice: number }) {
  return input.height - (input.logo > 0 ? input.logo + LOGO_GAP_MIN : 0) - input.notice - PROMPT_PADDING_TOP
}

// The logo gives way on a terminal too short for it and a prompt with one row to type in.
export function logoFits(input: { height: number; logo: number; notice: number }) {
  return promptSpace(input) - CHROME_ROWS >= 1
}

// Where the prompt sits: centered, or at the top or bottom with the logo directly above it.
export type Position = "top" | "middle" | "bottom"

// The heights of the gaps around the logo and of the home_bottom block, given the rows of the
// logo (0 when hidden) and of everything from the update notice to the prompt's bottom. When
// the column is too short they shrink in proportion to their size, as flexbox would, the gap
// above the logo no further than LOGO_GAP_MIN. Home sets these heights itself because Yoga does
// not shrink a box that has a height, so a tall prompt pushed the screen past its bottom.
export function stack(input: { height: number; logo: number; prompt: number; bottom: number; position: Position }) {
  const above = input.position === "middle" ? LOGO_GAP_ABOVE : LOGO_GAP_MIN
  const sizes = input.logo > 0 ? [above, LOGO_GAP_BELOW, input.bottom] : [0, 0, input.bottom]
  const mins = [input.logo > 0 ? LOGO_GAP_MIN : 0, 0, 0]
  const [gapAbove, gapBelow, bottom] = shrink(sizes, mins, input.height - input.logo - input.prompt).map(Math.floor)
  // At the bottom the tips go above the logo, so nothing sits between the prompt and the footer.
  return { gapAbove, gapBelow, bottom, tipsAbove: input.position === "bottom" }
}

// Each size gives up room in proportion to itself until they fit in `room`; one that reaches
// its minimum stops there and the rest give up the remainder.
function shrink(sizes: number[], mins: number[], room: number) {
  const result = [...sizes]
  const frozen = sizes.map((value, index) => value <= mins[index])
  for (;;) {
    const over = result.reduce((sum, value) => sum + value, 0) - room
    const basis = sizes.reduce((sum, value, index) => (frozen[index] ? sum : sum + value), 0)
    if (over <= 0 || basis === 0) return result
    const next = result.map((value, index) => (frozen[index] ? value : sizes[index] - (over * sizes[index]) / basis))
    const fixed = next.map((value, index) => !frozen[index] && value < mins[index])
    if (!fixed.some(Boolean)) return next
    fixed.forEach((hit, index) => {
      if (!hit) return
      frozen[index] = true
      result[index] = mins[index]
    })
  }
}
