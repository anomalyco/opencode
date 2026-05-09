import type { MessageV2 } from "@/session/message-v2"
import type { SessionMeta } from "./schema"

const USER_MAX = 500
const ASSISTANT_MAX = 300

export function formatTranscript(meta: SessionMeta, messages: MessageV2.WithParts[]): string {
  const lines: string[] = [
    `Session: ${meta.session_id.slice(0, 8)}`,
    `Date: ${new Date(meta.start_time).toISOString()}`,
    `Project: ${meta.project_path}`,
    `Duration: ${meta.duration_minutes} min`,
    "",
  ]
  for (const m of messages) {
    if (m.info.role === "user") {
      for (const p of m.parts) {
        if (p.type === "text") {
          const t = p.text.trim()
          if (t) lines.push(`[User]: ${t.slice(0, USER_MAX)}`)
        }
      }
      continue
    }
    if (m.info.role === "assistant") {
      for (const p of m.parts) {
        if (p.type === "text") {
          const t = p.text.trim()
          if (t) lines.push(`[Assistant]: ${t.slice(0, ASSISTANT_MAX)}`)
          continue
        }
        if (p.type === "tool" && p.tool) lines.push(`[Tool: ${p.tool}]`)
      }
    }
  }
  return lines.join("\n")
}

export const TRANSCRIPT_INLINE_LIMIT = 30_000
const TRANSCRIPT_CHUNK_SIZE = 25_000

export function chunkTranscript(text: string): string[] {
  if (text.length <= TRANSCRIPT_INLINE_LIMIT) return [text]
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += TRANSCRIPT_CHUNK_SIZE) {
    chunks.push(text.slice(i, i + TRANSCRIPT_CHUNK_SIZE))
  }
  return chunks
}

export * as InsightsTranscript from "./transcript"
