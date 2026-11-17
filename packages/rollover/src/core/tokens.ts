/** Single token-estimation site (spec Part A §4.1): estimateTokens(s) = ceil(len/4). */
import type { NMessage } from "./types"

export function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4)
}

/** Fallback context counter over a normalized message (text parts + tool input JSON + tool output). */
export function estimateMessageTokens(m: NMessage): number {
  let chars = 0
  for (const part of m.parts) {
    if (part.type === "text") chars += part.text?.length ?? 0
    else if (part.type === "tool") {
      if (part.input !== undefined) {
        try {
          chars += JSON.stringify(part.input).length
        } catch {
          chars += String(part.input).length
        }
      }
      chars += part.output?.length ?? 0
    }
  }
  return estimateTokens(chars === 0 ? "" : "x".repeat(chars))
}
