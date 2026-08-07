import { parseColor, type ColorInput, type RGBA } from "@opentui/core"
import { colorsEqual } from "../color/style.js"

export function parseDiagramRenderableColor(value: ColorInput | undefined): RGBA | undefined {
  return value ? parseColor(value) : undefined
}

export function setDiagramRenderableColor(
  current: RGBA | undefined,
  value: ColorInput | undefined,
  assign: (color: RGBA | undefined) => void,
  invalidate: () => void,
): void {
  const next = parseDiagramRenderableColor(value)
  if (colorsEqual(current, next)) return
  assign(next)
  invalidate()
}
