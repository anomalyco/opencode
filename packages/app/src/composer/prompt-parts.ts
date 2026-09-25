import type { ContentPart, ImageAttachmentPart, PathAttachmentPart, Prompt } from "./state"

/** Parts that sit beside the text rather than inside it. */
export function isAttachment(part: ContentPart): part is ImageAttachmentPart | PathAttachmentPart {
  return part.type === "image" || part.type === "path"
}

export function clonePrompt(prompt: Prompt): Prompt {
  return prompt.map((part) =>
    part.type === "file" ? { ...part, selection: part.selection ? { ...part.selection } : undefined } : { ...part },
  )
}

export function promptLength(prompt: Prompt) {
  return prompt.reduce((length, part) => length + ("content" in part ? part.content.length : 0), 0)
}

export function appendPrompt(prompt: Prompt, following: Prompt, separator = "\n\n"): Prompt {
  const start = promptLength(prompt)
  const offset = start + separator.length
  return [
    ...clonePrompt(prompt),
    { type: "text", content: separator, start, end: offset },
    ...clonePrompt(following).map((part) =>
      isAttachment(part) ? part : { ...part, start: part.start + offset, end: part.end + offset },
    ),
  ]
}
