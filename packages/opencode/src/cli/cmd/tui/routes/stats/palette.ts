import { RGBA } from "@opentui/core"
import { displayModel } from "./data"

/** Stable color palette for known model families, plus fallbacks. */
const KNOWN: Record<string, RGBA> = {
  opus: RGBA.fromHex("#b4b4ff"),
  sonnet: RGBA.fromHex("#7fd88f"),
  haiku: RGBA.fromHex("#e5c07b"),
  gpt: RGBA.fromHex("#56b6c2"),
  o3: RGBA.fromHex("#5c9cf5"),
  o1: RGBA.fromHex("#9d7cd8"),
  gemini: RGBA.fromHex("#e06c75"),
  grok: RGBA.fromHex("#f5a742"),
  llama: RGBA.fromHex("#c678dd"),
  qwen: RGBA.fromHex("#76cdcd"),
  deepseek: RGBA.fromHex("#fab283"),
}

const FALLBACK: RGBA[] = [
  RGBA.fromHex("#b4b4ff"),
  RGBA.fromHex("#7fd88f"),
  RGBA.fromHex("#e5c07b"),
  RGBA.fromHex("#56b6c2"),
  RGBA.fromHex("#9d7cd8"),
  RGBA.fromHex("#e06c75"),
  RGBA.fromHex("#f5a742"),
  RGBA.fromHex("#76cdcd"),
  RGBA.fromHex("#c678dd"),
]

/** Pick a stable color for a model id. */
export function modelColor(fullId: string, fallbackIndex: number): RGBA {
  const label = displayModel(fullId).toLowerCase()
  for (const [key, value] of Object.entries(KNOWN)) {
    if (label.includes(key)) return value
  }
  return FALLBACK[fallbackIndex % FALLBACK.length]
}
