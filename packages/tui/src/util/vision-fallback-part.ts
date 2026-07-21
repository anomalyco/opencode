import type { Part, TextPart } from "@kancode/sdk/v2"

export type VisionFallbackPart = TextPart & {
  metadata: {
    visionFallback: true
    providerID?: string
    modelID?: string
    modality?: string
  }
}

export function isVisionFallbackPart(part: Part): part is VisionFallbackPart {
  return part.type === "text" && part.metadata?.visionFallback === true
}

export function visionFallbackParts(parts: Part[]): VisionFallbackPart[] {
  return parts.filter(isVisionFallbackPart)
}

export function visionFallbackLabel(part: VisionFallbackPart) {
  const providerID = typeof part.metadata.providerID === "string" ? part.metadata.providerID : undefined
  const modelID = typeof part.metadata.modelID === "string" ? part.metadata.modelID : undefined
  const target = providerID && modelID ? `${providerID}/${modelID}` : undefined
  if (target) return `Vision fallback · ${target}`
  return "Vision fallback"
}

/** Collapse long describe bodies by default (match tool-output style thresholds). */
export function visionFallbackShouldCollapse(text: string) {
  const lines = text.split("\n")
  return lines.length > 4 || Array.from(text).length > 240
}
