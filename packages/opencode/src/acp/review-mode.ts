export * as ACPReviewMode from "./review-mode"

import { Flag, truthy } from "@opencode-ai/core/flag/flag"
import { ReviewOverlay } from "@opencode-ai/core/review-overlay"

let clientWriteTextFile = false
let forcedForAcp = false

export function forceEnableForAcp() {
  forcedForAcp = true
  syncEnabled()
}

export function setClientWriteTextFileSupported(supported: boolean) {
  clientWriteTextFile = supported
  syncEnabled()
}

// Review staging only works when the ACP client can receive staged edits via
// `fs/write_text_file`. Without that capability we must fall through to normal
// disk writes; otherwise edits would be staged in-memory and silently dropped
// (never written to disk nor sent to the client).
export function isActive() {
  if (Flag.OPENCODE_CLIENT !== "acp") return false
  if (!clientWriteTextFile) return false
  return forcedForAcp || truthy("OPENCODE_ACP_REVIEW")
}

export function syncEnabled() {
  ReviewOverlay.setEnabled(isActive())
}

export function reset() {
  clientWriteTextFile = false
  forcedForAcp = false
  ReviewOverlay.reset()
}
