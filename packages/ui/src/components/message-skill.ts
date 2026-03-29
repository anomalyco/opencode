import type { Part, TextPart } from "@opencode-ai/sdk/v2"

export function skillText(parts: Part[] | undefined) {
  return parts?.find(
    (part): part is TextPart =>
      part.type === "text" &&
      !!part.synthetic &&
      !!part.metadata &&
      typeof part.metadata.kind === "string" &&
      part.metadata.kind === "skill-template",
  )
}
