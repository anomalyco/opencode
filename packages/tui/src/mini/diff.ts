import type { RunDiffStyle } from "./types"

export function resolveDiffView(style: RunDiffStyle | undefined, width: number | undefined): "split" | "unified" {
  if (style === "split") return "split"
  if (style === "unified") return "unified"
  return (width ?? 0) > 120 ? "split" : "unified"
}
