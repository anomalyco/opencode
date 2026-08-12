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
  return {
    branch0: colors.primary ?? rgba(BRANCH_RGB[0]),
    branch1: colors.warning ?? rgba(BRANCH_RGB[1]),
    branch2: colors.secondary ?? rgba(BRANCH_RGB[2]),
    branch3: rgba(BRANCH_RGB[3]),
    branch4: rgba(BRANCH_RGB[4]),
    branch5: rgba(BRANCH_RGB[5]),
    branch6: rgba(BRANCH_RGB[6]),
    branch7: rgba(BRANCH_RGB[7]),
    commit: colors.primary ?? rgba(BRANCH_RGB[0]),
    merge: colors.secondary ?? rgba(BRANCH_RGB[2]),
    highlight: colors.warning ?? rgba(BRANCH_RGB[1]),
    reverse: colors.warning ?? rgba(BRANCH_RGB[5]),
    label: colors.text ?? rgba([228, 239, 232]),
  }
}
