import type { Part, TextPart, FilePart } from "@opencode-ai/sdk/v2"
import type { Prompt, FileAttachmentPart } from "@/context/prompt"

/**
 * Extract prompt content from message parts for restoring into the prompt input.
 * This is used by undo to restore the original user prompt.
 */
export function extractPromptFromParts(parts: Part[]): Prompt {
  const result: Prompt = []
  let position = 0

  for (const part of parts) {
    if (part.type === "text") {
      const textPart = part as TextPart
      if (!textPart.synthetic && textPart.text) {
        result.push({
          type: "text",
          content: textPart.text,
          start: position,
          end: position + textPart.text.length,
        })
        position += textPart.text.length
      }
    } else if (part.type === "file") {
      const filePart = part as FilePart
      if (filePart.source?.type === "file") {
        const path = filePart.source.path
        const content = "@" + path
        const attachment: FileAttachmentPart = {
          type: "file",
          path,
          content,
          start: position,
          end: position + content.length,
        }
        result.push(attachment)
        position += content.length
      }
    }
  }

  if (result.length === 0) {
    result.push({ type: "text", content: "", start: 0, end: 0 })
  }

  return result
}
