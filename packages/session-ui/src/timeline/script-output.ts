import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode/client/promise"
import { Predicate } from "effect"
import { TimelineRow } from "./timeline-row"

type Tool = Extract<SessionMessageAssistant["content"][number], { type: "tool" }>

/**
 * Where each script's Output row goes. A script whose changes are drawn right after it, as the next items of its group or
 * as the row after its own, reads steps, then changes, then Output: its Output row follows its last change. Anywhere
 * else, as when its changes are hidden or grouped apart from it, its Output row stays under its steps.
 */
export type ScriptOutputLayout = {
  /** Scripts, by part id, whose Output row follows their changes. */
  afterChanges: ReadonlySet<string>
  /** The script whose Output row follows a change, by the change's fact id (`messageID:partID`). */
  outputAfter: ReadonlyMap<string, Tool>
}

export function scriptOutputLayout(
  rows: readonly TimelineRow.TimelineRow[],
  messageByID: ReadonlyMap<string, SessionMessageInfo>,
): ScriptOutputLayout {
  const afterChanges = new Set<string>()
  const outputAfter = new Map<string, Tool>()

  const script = (messageID: string, partID: string) => {
    const message = messageByID.get(messageID)

    const part =
      message?.type === "assistant"
        ? message.content.find((item) => item.type === "tool" && item.id === partID)
        : undefined

    return part?.type === "tool" && part.name === "execute" ? part : undefined
  }

  // The changes of the script at refs[from - 1] that come next, in order.
  const changesOf = (refs: readonly { messageID: string; partID: string }[], from: number, scriptID: string) => {
    const end = refs.findIndex((ref, index) => index >= from && !ref.partID.startsWith(`${scriptID}:file:`))

    return refs.slice(from, end < 0 ? refs.length : end)
  }

  const place = (tool: Tool, changes: readonly { messageID: string; partID: string }[]) => {
    const last = changes.at(-1)

    if (!last) return
    afterChanges.add(tool.id)
    outputAfter.set(`${last.messageID}:${last.partID}`, tool)
  }

  rows.forEach((row, index) => {
    if (!Predicate.isTagged(row, "AssistantPart")) return
    const refs = row.group.type === "part" ? [row.group.ref] : row.group.refs

    refs.forEach((ref, at) => {
      const tool = script(ref.messageID, ref.partID)

      if (!tool) return

      // Its changes follow it in the same group.
      if (at < refs.length - 1) return place(tool, changesOf(refs, at + 1, tool.id))
      const next = rows[index + 1]

      // Or they are the row after its own, drawn as cards.
      if (!next || !Predicate.isTagged(next, "AssistantPart") || !TimelineRow.scriptChanges(next)) return
      const nextRefs = next.group.type === "part" ? [next.group.ref] : next.group.refs

      place(tool, changesOf(nextRefs, 0, tool.id))
    })
  })

  return { afterChanges, outputAfter }
}
