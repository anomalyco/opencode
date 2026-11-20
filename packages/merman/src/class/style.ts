import { RGBA } from "@opentui/core"
import { rgba, type DiagramRgb } from "../core/color/style.js"
import type { ClassCellStyle } from "./types.js"

const DEFAULT_THEME_RGB = {
  classTitle: [228, 239, 232],
  classText: [215, 229, 221],
  classBorder: [141, 163, 151],
  annotation: [154, 184, 169],
  edge: [134, 225, 200],
  label: [134, 225, 200],
  namespace: [76, 99, 89],
  namespaceLabel: [76, 99, 89],
} as const satisfies Record<ClassCellStyle, DiagramRgb>

export type ClassStyleColors = Record<ClassCellStyle, RGBA>

export function resolveClassStyleColors(
  colors: Partial<Record<ClassCellStyle, RGBA | undefined>> = {},
): ClassStyleColors {
  return Object.fromEntries(
    Object.entries(DEFAULT_THEME_RGB).map(([style, rgb]) => [style, colors[style as ClassCellStyle] ?? rgba(rgb)]),
  ) as ClassStyleColors
}
