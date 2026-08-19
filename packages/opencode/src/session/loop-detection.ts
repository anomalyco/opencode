import { SessionV1 } from "@opencode-ai/core/v1/session"
import { PartID } from "./schema"
import { ShellID } from "../tool/shell/id"

/**
 * Repeatedly failing the same shell command without changing the underlying
 * approach is the classic debugging loop: propose a hypothesis, edit source,
 * re-run, see the same failure, propose another hypothesis at the same layer.
 * opencode sits between the model and the tools, so it can notice the pattern
 * and nudge the model to descend to the evidence (logs, core dumps, traces)
 * instead of cycling at the source-code layer forever.
 */
const LOOP_THRESHOLD = 2

const LOOP_HINT_MARKER = "debugging-loop-hint"

export function apply(messages: SessionV1.WithParts[]) {
  const userMessage = messages.findLast((msg) => msg.info.role === "user")
  if (!userMessage) return messages

  if (
    userMessage.parts.some(
      (part) => part.type === "text" && part.synthetic && part.text.startsWith(LOOP_HINT_MARKER),
    )
  ) {
    return messages
  }

  const failures = new Map<string, number>()

  for (const msg of messages) {
    if (msg.info.role !== "assistant") continue
    for (const part of msg.parts) {
      if (part.type !== "tool" || part.tool !== ShellID.ToolID || part.state.status !== "completed") continue
      const command = (part.state.input as { command?: string } | undefined)?.command
      if (!command) continue
      const exit = part.state.metadata?.exit
      if (typeof exit !== "number") continue
      if (exit !== 0) failures.set(command, (failures.get(command) ?? 0) + 1)
    }
  }

  const worst = Math.max(0, ...failures.values())
  if (worst < LOOP_THRESHOLD) return messages

  const command = Array.from(failures.entries()).find(([, count]) => count === worst)?.[0]
  const hint = [
    LOOP_HINT_MARKER,
    `The same command has failed ${worst} times:`,
    ``,
    `  ${command}`,
    ``,
    `Repeatedly re-running the same failing command at the same layer is a debugging loop. Instead of`,
    `proposing another hypothesis and editing source again, stop and examine the actual evidence:`,
    `the command's error output above, logs, core dumps, or network traces. Read the error message`,
    `carefully and trace back to the root cause before changing code.`,
  ].join("\n")

  userMessage.parts.push({
    id: PartID.ascending(),
    messageID: userMessage.info.id,
    sessionID: userMessage.info.sessionID,
    type: "text",
    text: hint,
    synthetic: true,
  })
  return messages
}

export * as LoopDetection from "./loop-detection"
