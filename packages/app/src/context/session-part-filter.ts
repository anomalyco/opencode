import type { Part } from "@opencode-ai/sdk/v2/client"

const HIDDEN_PARTS = new Set(["patch", "step-start"])

export function includeSessionPart(part: Pick<Part, "type">) {
  return !HIDDEN_PARTS.has(part.type)
}
