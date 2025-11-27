import type { Part } from "@opencode-ai/sdk/client"

export const sanitize = (text: string | undefined, remove?: RegExp) => (remove ? text?.replace(remove, "") : text) ?? ""

export const sanitizePart = (part: Part, remove: RegExp | undefined) => {
  if (part.type === "text") {
    part.text = sanitize(part.text, remove)
  } else if (part.type === "reasoning") {
    part.text = sanitize(part.text, remove)
  } else if (part.type === "tool") {
    if (part.state.status === "completed" || part.state.status === "error") {
      for (const key in part.state.metadata) {
        if (typeof part.state.metadata[key] === "string") {
          part.state.metadata[key] = sanitize(part.state.metadata[key] as string, remove)
        }
      }
      for (const key in part.state.input) {
        if (typeof part.state.input[key] === "string") {
          part.state.input[key] = sanitize(part.state.input[key] as string, remove)
        }
      }
      if ("error" in part.state) {
        part.state.error = sanitize(part.state.error as string, remove)
      }
    }
  }
  return part
}
