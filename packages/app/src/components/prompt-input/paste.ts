import { isLargePaste, LEGACY_MANUAL_PASTE_POLICY } from "@opencode-ai/session-ui/v2/prompt-input/paste"

export { normalizePaste } from "@opencode-ai/session-ui/v2/prompt-input/paste"

export function pasteMode(text: string) {
  if (isLargePaste(text, LEGACY_MANUAL_PASTE_POLICY)) return "manual"
  if (text.includes("\n") || text.includes("\r")) return "manual"
  return "native"
}
