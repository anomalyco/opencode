import type {
  SessionMessageAssistant,
  SessionMessageAssistantReasoning,
  SessionMessageAssistantTool,
  SessionMessageInfo,
} from "@opencode/client"
import { canonicalToolName, executeCalls } from "../../util/tool-display"
import { visitEntries } from "./anchor-view"
import { instructionPaths, type PartRef, type SessionEntry, type SessionNode } from "./grouping/session"
import { reasoningContent } from "./message-parts"
import { resolvePart } from "./rows"

type Item = {
  message: SessionMessageAssistant
  part: SessionMessageAssistantReasoning | SessionMessageAssistantTool
}

/** Summary for an activity group's subtree; permission-blocked tools are left out. */
export function summarizeActivity(
  node: Extract<SessionNode, { type: "group" }>,
  message: (messageID: string) => SessionMessageInfo | undefined,
  pending: readonly PartRef[] = [],
) {
  const entries: SessionEntry[] = []
  visitEntries(node.children, (entry) => entries.push(entry))
  const items = entries.flatMap((entry) => {
    if (entry.type !== "part") return []
    if (pending.some((ref) => ref.messageID === entry.ref.messageID && ref.partID === entry.ref.partID)) return []
    const item = message(entry.ref.messageID)
    if (item?.type !== "assistant") return []
    const part = resolvePart(item, entry.ref.partID)
    return part?.type === "reasoning" || part?.type === "tool" ? [{ message: item, part }] : []
  })
  const files = new Set(
    entries.flatMap((entry) => (entry.type === "message" ? instructionPaths(message(entry.messageID)) : [])),
  )
  return activitySummary(items, files.size)
}

/**
 * Low verbosity's activity summary, e.g. "3 commands, 1 edit, 2 thoughts, 4 reads".
 * The label counts only finished work; running items are reported through `active`.
 * Code-mode `execute` counts its finished nested calls rather than itself.
 * Instructions count distinct loaded files, matching the instruction subgroup.
 */
export function activitySummary(items: readonly Item[], instructions: number) {
  const counts = { command: 0, edit: 0, thought: 0, read: 0, tool: 0, instruction: instructions }
  items.forEach((item) => {
    if (item.part.type === "reasoning") {
      // Redacted-only reasoning renders nothing, so it isn't a visible thought.
      if (!isActive(item) && reasoningContent(item.part)) counts.thought++
      return
    }
    const name = canonicalToolName(item.part.name)
    if (name === "execute") {
      executeCalls(item.part.state.status === "streaming" ? undefined : item.part.state.metadata?.toolCalls).forEach(
        (call) => {
          if (call.status === "running") return
          if (canonicalToolName(call.tool) === "read") counts.read++
          else counts.tool++
        },
      )
      return
    }
    if (isActive(item)) return
    if (name === "shell") counts.command++
    else if (name === "read") counts.read++
    else if (name === "edit" || name === "write" || name === "patch") counts.edit++
    else counts.tool++
  })
  return {
    label: Object.entries(counts)
      .filter(([, count]) => count > 0)
      .map(([name, count]) => `${count} ${name}${count === 1 ? "" : "s"}`)
      .join(", "),
    active: items.some(isActive),
    failed: items.some(failed),
  }
}

function isActive(item: Item) {
  if (item.part.type === "reasoning")
    return item.part.time?.completed === undefined && item.message.time.completed === undefined
  return item.part.state.status === "streaming" || item.part.state.status === "running"
}

function failed(item: Item) {
  if (item.part.type !== "tool") return false
  if (item.part.state.status === "error") return true
  if (canonicalToolName(item.part.name) !== "execute" || item.part.state.status === "streaming") return false
  const metadata = item.part.state.metadata
  return metadata?.error === true || executeCalls(metadata?.toolCalls).some((call) => call.status === "error")
}
