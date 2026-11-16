export * as SyncDecision from "./decide.js"

import type { LanguageModelV3Prompt } from "@ai-sdk/provider"
import { Fingerprint } from "./fingerprint.js"
import type { SessionRecord } from "./record.js"

export function decide(prompt: LanguageModelV3Prompt, record?: SessionRecord.Record) {
  const saved = record?.history ?? []
  const groups = Fingerprint.groups(prompt, record?.interrupted ? saved : undefined)
  if (saved.length === 0) return { kind: "fresh", start: 0 } as const

  let matched = 0
  while (matched < saved.length && matched < groups.length) {
    if (saved[matched]!.hash !== groups[matched]!.hash) break
    matched++
  }
  if (matched === 0) return { kind: "fresh", start: 0 } as const
  // Changed histories need an isolated branch, or a rebuild when no safe checkpoint survives.
  if (matched < saved.length) return { kind: "changed", start: 0 } as const

  // Claude's drained transcript owns the interrupted reply, not OpenCode's partial copy.
  while (record?.interrupted && groups[matched]?.role === "assistant") {
    const reply = prompt[groups[matched]!.start]!
    if (reply.role !== "assistant" || reply.content.some((part) => part.type === "tool-call")) break
    matched++
  }
  const start = groups[matched]?.start ?? prompt.length
  if (record?.interrupted && start === prompt.length) return { kind: "changed", start: 0 } as const
  const missed = groups.slice(matched)
  const kind = missed.some((group) => group.role !== "user") ? "catch-up" : "continue"
  return { kind, start } as const
}

// A branch must not end between a native tool call and its results.
export function boundary(prompt: LanguageModelV3Prompt, record?: SessionRecord.Record) {
  const groups = Fingerprint.groups(prompt)
  const history = record?.history ?? []
  const pending = new Set<string>()
  let found: { messageID: string; start: number; history: readonly SessionRecord.Checkpoint[] } | undefined
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]!
    // Undo can resubmit identical input; keep the current user group for the new turn.
    if (i === groups.length - 1 && group.role === "user") break
    const checkpoint = history[i]
    if (!checkpoint || checkpoint.hash !== group.hash) break
    for (const message of prompt.slice(group.start, group.end)) {
      if (message.role === "system") continue
      for (const part of message.content) {
        if (part.type === "tool-call") pending.add(part.toolCallId)
        if (part.type === "tool-result") pending.delete(part.toolCallId)
      }
    }
    if (checkpoint.claudeMessageID && pending.size === 0) {
      found = { messageID: checkpoint.claudeMessageID, start: group.end, history: history.slice(0, i + 1) }
    }
  }
  return found
}
