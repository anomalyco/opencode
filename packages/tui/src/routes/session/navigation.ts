import type { Message, Part } from "@opencode-ai/sdk/v2"

export type NavigationScope = "prompt" | "block" | "landmark"

// Tool calls worth stopping on when skipping between landmarks: the questions
// the user answered, the todo lists that record the plan, and subagent tasks.
// Edits, reads and shell calls are left out because they are as dense as the
// blocks themselves.
const LANDMARK_TOOLS = new Set(["question", "todowrite", "task"])

// IDs of the transcript blocks a navigation scope stops on. A user prompt is
// identified by its message ID, every assistant block by its part ID - the
// same IDs the session route assigns to the rendered boxes.
//
// "prompt" stops only on user prompts.
//
// "block" stops on every prompt, text part, reasoning part with content, and
// tool call. Reasoning without content (encrypted, or an empty "Thinking"
// placeholder) renders as a bare header and is skipped.
//
// "landmark" stops on prompts, the last text part of each turn, and the tool
// calls in LANDMARK_TOOLS.
export function navigationTargets(
  messages: readonly Message[],
  parts: (messageID: string) => readonly Part[],
  scope: NavigationScope,
) {
  const targets = new Set<string>()
  let final: string | undefined

  for (const message of messages) {
    if (message.role === "user") {
      if (final) targets.add(final)
      final = undefined
      if (
        parts(message.id).some((part) => part.type === "text" && !part.synthetic && !part.ignored && part.text.trim())
      )
        targets.add(message.id)
      continue
    }
    if (scope === "prompt") continue
    for (const part of parts(message.id)) {
      if (part.type === "text" && part.text.trim()) {
        if (scope === "block") targets.add(part.id)
        final = part.id
      }
      if (part.type === "reasoning" && scope === "block" && part.text.replace("[REDACTED]", "").trim())
        targets.add(part.id)
      if (part.type === "tool" && (scope === "block" || LANDMARK_TOOLS.has(part.tool))) targets.add(part.id)
    }
  }
  if (final) targets.add(final)
  return targets
}

// Whether a transcript entry is a landmark of `navigationTargets(..., "landmark")`: a part by its
// own ID, a message-level entry (prompt, footer, error box, compaction divider) when the message
// or any of its parts is one.
export function isLandmark(
  targets: ReadonlySet<string>,
  parts: readonly Part[],
  messageID: string,
  partID?: string,
) {
  if (partID) return targets.has(partID)
  return targets.has(messageID) || parts.some((part) => targets.has(part.id))
}

// Picks the block to bring to `anchor`, the row a navigated-to block lands on.
// "next" is the nearest block below the anchor, "prev" the nearest above it, so
// a block already at the anchor counts as current. A renderer can draw one part
// as several boxes, so each ID is placed at its first box.
export function pickNavigationTarget(
  blocks: readonly { id: string; y: number }[],
  anchor: number,
  direction: "next" | "prev",
) {
  const tops = new Map<string, number>()
  for (const block of blocks) tops.set(block.id, Math.min(block.y, tops.get(block.id) ?? Infinity))
  const candidates = [...tops].filter(([, y]) => (direction === "next" ? y > anchor : y < anchor))
  if (!candidates.length) return
  const [id, y] = candidates.reduce((best, item) =>
    direction === "next" ? (item[1] < best[1] ? item : best) : item[1] > best[1] ? item : best,
  )
  return { id, y }
}
