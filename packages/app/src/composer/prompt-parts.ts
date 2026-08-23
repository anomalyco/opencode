import type { Prompt } from "./state"

export function clonePrompt(prompt: Prompt): Prompt {
  return prompt.map((part) =>
    part.type === "file" ? { ...part, selection: part.selection ? { ...part.selection } : undefined } : { ...part },
  )
}

export function promptLength(prompt: Prompt) {
  return prompt.reduce((length, part) => length + ("content" in part ? part.content.length : 0), 0)
}
