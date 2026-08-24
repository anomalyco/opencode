import { RGBA } from "@opentui/core"
import { rgba, type DiagramRgb } from "../core/color/style.js"
import type { GitGraphCellStyle } from "./types.js"

const BRANCH_RGB = [
  [134, 225, 200],
  [230, 177, 126],
  [154, 184, 169],
  [198, 160, 246],
  [126, 189, 230],
  [225, 134, 166],
  [190, 210, 120],
  [180, 180, 210],
] as const satisfies readonly DiagramRgb[]

export type GitGraphStyleColors = Required<Record<GitGraphCellStyle, RGBA>>

export function resolveGitGraphStyleColors(
  colors: Partial<Record<"primary" | "secondary" | "muted" | "warning" | "text", RGBA | undefined>> = {},
): GitGraphStyleColors {
  const rail = colors.muted ?? rgba([111, 138, 126])
  return {
    branch0: rail,
    branch1: rail,
    branch2: rail,
    branch3: rail,
    branch4: rail,
    branch5: rail,
    branch6: rail,
    branch7: rail,
    commit: colors.primary ?? rgba(BRANCH_RGB[0]),
    merge: colors.secondary ?? rgba(BRANCH_RGB[2]),
    highlight: colors.warning ?? rgba(BRANCH_RGB[1]),
    reverse: colors.warning ?? rgba(BRANCH_RGB[5]),
    label: colors.text ?? rgba([228, 239, 232]),
  }
}
