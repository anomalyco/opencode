import type { Part, Session } from "@opencode-ai/sdk/v2/client"

export type FilterResult = { speakable: boolean; reason: string }

export function isAutoSpeakable(part: Part, session?: Session): FilterResult {
  if (part.type !== "text") return { speakable: false, reason: "filtered_type" }
  if (part.synthetic === true) return { speakable: false, reason: "filtered_synthetic" }
  if (part.ignored === true) return { speakable: false, reason: "filtered_ignored" }
  if (!part.time?.end) return { speakable: false, reason: "filtered_incomplete" }
  if (!part.text.trim()) return { speakable: false, reason: "filtered_empty" }
  if (!session) return { speakable: false, reason: "filtered_no_session" }
  if (session.parentID) return { speakable: false, reason: "filtered_subagent" }
  return { speakable: true, reason: "speakable" }
}
