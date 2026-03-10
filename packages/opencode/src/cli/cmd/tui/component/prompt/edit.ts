import type { PromptInfo } from "./history"

export function lead(prompt: PromptInfo, text: string): PromptInfo {
  const size = Bun.stringWidth(text)

  return {
    ...prompt,
    input: text + prompt.input,
    parts: prompt.parts.map((part) => {
      if ((part.type === "file" || part.type === "text") && part.source?.text) {
        return {
          ...part,
          source: {
            ...part.source,
            text: {
              ...part.source.text,
              start: part.source.text.start + size,
              end: part.source.text.end + size,
            },
          },
        }
      } else if (part.type === "agent" && part.source) {
        return {
          ...part,
          source: {
            ...part.source,
            start: part.source.start + size,
            end: part.source.end + size,
          },
        }
      }

      return part
    }),
  }
}
