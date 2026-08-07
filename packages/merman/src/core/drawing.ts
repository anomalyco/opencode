import { BorderChars, type BorderCharacters } from "@opentui/core"
import {
  directionBetween,
  walkOrthogonalSegment,
  type DiagramBounds,
  type DiagramDirection,
  type DiagramPoint,
} from "./geometry.js"

export type DiagramLineCornerStyle = "square" | "rounded"
export type DiagramLineStyle = "single" | "heavy" | "dashed"
export type DiagramArrowHeadStyle = "filled" | "line"

export interface DiagramDiamondCharacters {
  topLeft: string
  topRight: string
  upperLeft: string
  upperLeftJoin: string
  upperRightJoin: string
  upperRight: string
  vertical: string
  lowerLeft: string
  lowerLeftJoin: string
  lowerRightJoin: string
  lowerRight: string
  bottomLeft: string
  bottomRight: string
  horizontal: string
}

export const DIAGRAM_ARROW_HEADS = new Set(["▶", "◀", "▼", "▲", "→", "←", "↓", "↑"])
const HEAVY_LINE_GLYPHS = new Set(Object.values(BorderChars.heavy))

export const DIAGRAM_DIAMOND_CHARS = {
  topLeft: "╭",
  topRight: "╮",
  upperLeft: "╭",
  upperLeftJoin: "╯",
  upperRightJoin: "╰",
  upperRight: "╮",
  vertical: "│",
  lowerLeft: "╰",
  lowerLeftJoin: "╮",
  lowerRightJoin: "╭",
  lowerRight: "╯",
  bottomLeft: "╰",
  bottomRight: "╯",
  horizontal: "─",
} as const satisfies DiagramDiamondCharacters

export function diagramDiamondCharactersFromBorder(chars: BorderCharacters): DiagramDiamondCharacters {
  return {
    topLeft: chars.topLeft,
    topRight: chars.topRight,
    upperLeft: chars.topLeft,
    upperLeftJoin: chars.bottomRight,
    upperRightJoin: chars.bottomLeft,
    upperRight: chars.topRight,
    vertical: chars.vertical,
    lowerLeft: chars.bottomLeft,
    lowerLeftJoin: chars.topRight,
    lowerRightJoin: chars.topLeft,
    lowerRight: chars.bottomRight,
    bottomLeft: chars.bottomLeft,
    bottomRight: chars.bottomRight,
    horizontal: chars.horizontal,
  }
}

function lineDirections(char: string): readonly DiagramDirection[] | undefined {
  switch (char) {
    case "─":
      return ["left", "right"]
    case "│":
      return ["up", "down"]
    case "━":
      return ["left", "right"]
    case "┃":
      return ["up", "down"]
    case "┌":
    case "╭":
    case "┏":
      return ["right", "down"]
    case "┐":
    case "╮":
    case "┓":
      return ["left", "down"]
    case "└":
    case "╰":
    case "┗":
      return ["up", "right"]
    case "┘":
    case "╯":
    case "┛":
      return ["up", "left"]
    case "├":
    case "┣":
      return ["up", "down", "right"]
    case "┤":
    case "┫":
      return ["up", "down", "left"]
    case "┬":
    case "┳":
      return ["left", "right", "down"]
    case "┴":
    case "┻":
      return ["left", "right", "up"]
    case "┼":
    case "╋":
      return ["up", "down", "left", "right"]
    default:
      return undefined
  }
}

export function diagramLineGlyph(
  directions: ReadonlySet<DiagramDirection>,
  cornerStyle: DiagramLineCornerStyle = "square",
  lineStyle: DiagramLineStyle = "single",
): string {
  const up = directions.has("up")
  const down = directions.has("down")
  const left = directions.has("left")
  const right = directions.has("right")
  if (lineStyle === "heavy") {
    const chars = BorderChars.heavy
    if (up && down && left && right) return chars.cross
    if (up && down && right) return chars.leftT
    if (up && down && left) return chars.rightT
    if (left && right && down) return chars.topT
    if (left && right && up) return chars.bottomT
    if (up && right) return chars.bottomLeft
    if (up && left) return chars.bottomRight
    if (down && right) return chars.topLeft
    if (down && left) return chars.topRight
    if (up || down) return chars.vertical
    return chars.horizontal
  }
  if (up && down && left && right) return "┼"
  if (up && down && right) return "├"
  if (up && down && left) return "┤"
  if (left && right && down) return "┬"
  if (left && right && up) return "┴"
  if (up && right) return cornerStyle === "rounded" ? "╰" : "└"
  if (up && left) return cornerStyle === "rounded" ? "╯" : "┘"
  if (down && right) return cornerStyle === "rounded" ? "╭" : "┌"
  if (down && left) return cornerStyle === "rounded" ? "╮" : "┐"
  if (up || down) return "│"
  return "─"
}

function isHeavyLineGlyph(char: string): boolean {
  return HEAVY_LINE_GLYPHS.has(char)
}

function segmentGlyph(direction: DiagramDirection, lineStyle: DiagramLineStyle | undefined): string {
  const directions = new Set<DiagramDirection>(
    direction === "left" || direction === "right" ? ["left", "right"] : ["up", "down"],
  )
  return diagramLineGlyph(directions, "square", lineStyle === "heavy" ? "heavy" : "single")
}

export function mergeDiagramLineGlyph(
  existing: string,
  incoming: string,
  cornerStyle: DiagramLineCornerStyle = "square",
): string | undefined {
  const existingDirections = lineDirections(existing)
  const incomingDirections = lineDirections(incoming)
  if (!existingDirections || !incomingDirections) return undefined

  return diagramLineGlyph(
    new Set([...existingDirections, ...incomingDirections]),
    cornerStyle,
    isHeavyLineGlyph(existing) && isHeavyLineGlyph(incoming) ? "heavy" : "single",
  )
}

export function diagramArrowHead(direction: DiagramDirection, style: DiagramArrowHeadStyle = "filled"): string {
  if (style === "line") {
    if (direction === "right") return "→"
    if (direction === "left") return "←"
    if (direction === "up") return "↑"
    return "↓"
  }

  if (direction === "right") return "▶"
  if (direction === "left") return "◀"
  if (direction === "up") return "▲"
  return "▼"
}

export function diagramArrowHeadBetween(
  from: DiagramPoint,
  to: DiagramPoint,
  style: DiagramArrowHeadStyle = "filled",
): string {
  const direction = directionBetween(from, to)
  return direction ? diagramArrowHead(direction, style) : diagramArrowHead("right", style)
}

export function drawDiagramFrame(
  bounds: DiagramBounds,
  chars: BorderCharacters,
  setCell: (x: number, y: number, char: string) => void,
): void {
  setCell(bounds.left, bounds.top, chars.topLeft)
  setCell(bounds.left + bounds.width - 1, bounds.top, chars.topRight)
  setCell(bounds.left, bounds.top + bounds.height - 1, chars.bottomLeft)
  setCell(bounds.left + bounds.width - 1, bounds.top + bounds.height - 1, chars.bottomRight)
  for (let x = bounds.left + 1; x < bounds.left + bounds.width - 1; x++) {
    setCell(x, bounds.top, chars.horizontal)
    setCell(x, bounds.top + bounds.height - 1, chars.horizontal)
  }
  for (let y = bounds.top + 1; y < bounds.top + bounds.height - 1; y++) {
    setCell(bounds.left, y, chars.vertical)
    setCell(bounds.left + bounds.width - 1, y, chars.vertical)
  }
}

export function drawDiagramDiamond(
  bounds: DiagramBounds,
  setCell: (x: number, y: number, char: string) => void,
  chars: DiagramDiamondCharacters = DIAGRAM_DIAMOND_CHARS,
): void {
  const left = bounds.left
  const right = bounds.left + bounds.width - 1
  const top = bounds.top
  const bottom = bounds.top + bounds.height - 1
  const capInset = Math.min(2, Math.max(1, Math.floor((bounds.width - 1) / 2)))
  const capLeft = left + capInset
  const capRight = right - capInset

  setCell(capLeft, top, chars.topLeft)
  for (let x = capLeft + 1; x < capRight; x++) setCell(x, top, chars.horizontal)
  setCell(capRight, top, chars.topRight)

  setCell(left, top + 1, chars.upperLeft)
  for (let x = left + 1; x < capLeft; x++) setCell(x, top + 1, chars.horizontal)
  setCell(capLeft, top + 1, chars.upperLeftJoin)
  setCell(capRight, top + 1, chars.upperRightJoin)
  for (let x = capRight + 1; x < right; x++) setCell(x, top + 1, chars.horizontal)
  setCell(right, top + 1, chars.upperRight)

  for (let y = top + 2; y < bottom - 1; y++) {
    setCell(left, y, chars.vertical)
    setCell(right, y, chars.vertical)
  }

  setCell(left, bottom - 1, chars.lowerLeft)
  for (let x = left + 1; x < capLeft; x++) setCell(x, bottom - 1, chars.horizontal)
  setCell(capLeft, bottom - 1, chars.lowerLeftJoin)
  setCell(capRight, bottom - 1, chars.lowerRightJoin)
  for (let x = capRight + 1; x < right; x++) setCell(x, bottom - 1, chars.horizontal)
  setCell(right, bottom - 1, chars.lowerRight)

  setCell(capLeft, bottom, chars.bottomLeft)
  for (let x = capLeft + 1; x < capRight; x++) setCell(x, bottom, chars.horizontal)
  setCell(capRight, bottom, chars.bottomRight)
}

export function drawOrthogonalPath(
  points: readonly DiagramPoint[],
  setCell: (x: number, y: number, char: string) => void,
  options: { cornerStyle?: DiagramLineCornerStyle; lineStyle?: DiagramLineStyle } = {},
): void {
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1]!
    const to = points[index]!
    const direction = directionBetween(from, to)
    if (!direction) continue
    const glyph = segmentGlyph(direction, options.lineStyle)
    let step = index === 1 ? 0 : 1
    walkOrthogonalSegment(from, to, index === 1, (point) => {
      if (options.lineStyle !== "dashed" || step % 2 === 0) setCell(point.x, point.y, glyph)
      step += 1
    })
  }

  for (let index = 1; index < points.length - 1; index++) {
    const previous = points[index - 1]!
    const current = points[index]!
    const next = points[index + 1]!
    const fromDirection = directionBetween(current, previous)
    const toDirection = directionBetween(current, next)
    const directions = new Set<DiagramDirection>()
    if (fromDirection) directions.add(fromDirection)
    if (toDirection) directions.add(toDirection)
    setCell(
      current.x,
      current.y,
      diagramLineGlyph(directions, options.cornerStyle, options.lineStyle === "heavy" ? "heavy" : "single"),
    )
  }
}
