import { formatFallbackTarget, type ModelRef } from "../util/attachment-fallback"

export type VisionFallbackConfigRow =
  | { value: "__vision_capable__"; title: string }
  | { value: "clear-model-fallback"; title: string }
  | { value: "set-model-fallback"; title: string }
  | { value: "opt-out-model-fallback"; title: string }

/**
 * Pure vision-fallback section for DialogConfig (titles/values only).
 * Exactly one of: vision-capable info, Clear (when per-model entry), or Set (+ optional opt-out).
 */
export function visionFallbackConfigRows(input: {
  visionCapable: boolean
  global: ModelRef | null | undefined
  perModelEntry: ModelRef | null | undefined
}): VisionFallbackConfigRow[] {
  if (input.visionCapable) {
    return [
      {
        value: "__vision_capable__",
        title: "No fallback needed (vision-capable)",
      },
    ]
  }

  if (input.perModelEntry !== undefined) {
    return [
      {
        value: "clear-model-fallback",
        title: `Clear fallback vision model: ${formatFallbackTarget(input.perModelEntry)}`,
      },
    ]
  }

  const setSuffix = input.global ? `global: ${formatFallbackTarget(input.global)}` : ""
  const rows: VisionFallbackConfigRow[] = [
    {
      value: "set-model-fallback",
      title: setSuffix ? `Set fallback vision model (${setSuffix})` : "Set fallback vision model",
    },
  ]
  if (input.global) {
    rows.push({
      value: "opt-out-model-fallback",
      title: "Disable vision fallback for this model",
    })
  }
  return rows
}
