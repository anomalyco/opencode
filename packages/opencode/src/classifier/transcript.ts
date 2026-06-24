import type { SessionV1 } from "@opencode-ai/core/v1/session"
import type { TranscriptEntry } from "./types"

/**
 * Build a reasoning-blind transcript: user text + assistant tool calls only.
 * Assistant prose and all tool *results* are dropped. This is both a
 * prompt-injection defense (hostile content enters via tool output) and an
 * anti-rationalization defense (the agent can't talk the classifier into a
 * bad call). After Claude Code's auto-mode transcript.
 */
export function buildTranscript(messages: SessionV1.WithParts[]): TranscriptEntry[] {
  const out: TranscriptEntry[] = []
  for (const msg of messages) {
    if (msg.info.role === "user") {
      const texts: string[] = []
      for (const part of msg.parts) if (part.type === "text") texts.push(part.text)
      const text = texts.join("\n").trim()
      if (text) out.push({ role: "user", text })
    } else if (msg.info.role === "assistant") {
      for (const part of msg.parts) {
        if (part.type !== "tool") continue
        const input = "input" in part.state ? part.state.input : {}
        out.push({ role: "assistant", tool: part.tool, input: projectToolInput(part.tool, input) })
      }
    }
  }
  return out
}

/**
 * Reduce a tool's input to the security-relevant fields the classifier needs.
 * Keeps the transcript small and avoids leaking large/irrelevant payloads.
 * Extend per tool as needed; default passes the input through unchanged.
 */
export function projectToolInput(tool: string, input: unknown): unknown {
  if (input == null || typeof input !== "object") return input
  const obj = input as Record<string, unknown>
  switch (tool) {
    case "bash":
      return { command: obj["command"], description: obj["description"] }
    case "webfetch":
      return { url: obj["url"] }
    default:
      return input
  }
}
