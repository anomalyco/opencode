import figures from "figures"
import cliBoxes from "cli-boxes"

export const Glyphs = {
  tick: figures.tick,
  cross: figures.cross,
  pointer: figures.pointer,
  pointerSmall: figures.pointerSmall,
  arrowRight: figures.arrowRight,
  bullet: figures.bullet,
  line: figures.line,
  ellipsis: figures.ellipsis,
  boxes: cliBoxes,
} as const

export { figures, cliBoxes }
