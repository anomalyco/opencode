import type { SessionStatus } from "@opencode-ai/sdk/v2"

export function isDefaultTitle(title: string) {
  return /^(New session - |Child session - )\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(title)
}

const TITLE_SPINNER_FRAMES = ["· ", " ·"] as const

export function titleStatusGlyph(status: SessionStatus | undefined, frame = 0) {
  if (status?.type === "busy" || status?.type === "retry")
    return TITLE_SPINNER_FRAMES[frame % TITLE_SPINNER_FRAMES.length]
  return "*"
}
