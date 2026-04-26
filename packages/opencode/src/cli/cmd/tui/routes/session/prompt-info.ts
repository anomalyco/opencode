import type { Part } from "@opencode-ai/sdk/v2"
import type { PromptInfo } from "@tui/component/prompt/history"
import { strip } from "@tui/component/prompt/part"

function invocation(part: Part): string | undefined {
  if (part.type !== "text") return
  const metadata = part.metadata
  if (!metadata || typeof metadata !== "object") return
  const command = (metadata as Record<string, unknown>)["command"]
  if (!command || typeof command !== "object") return

  const invocation = (command as Record<string, unknown>)["invocation"]
  if (typeof invocation === "string" && invocation.length > 0) return invocation

  const name = (command as Record<string, unknown>)["name"]
  if (typeof name !== "string" || name.length === 0) return

  const args = (command as Record<string, unknown>)["arguments"]
  if (typeof args !== "string" || args.length === 0) return `/${name}`
  return `/${name} ${args}`
}

export function createPromptInfoFromParts(parts: Part[]): PromptInfo {
  const command = parts.reduce<string | undefined>((result, part) => result ?? invocation(part), undefined)
  return parts.reduce(
    (agg, part) => {
      if (part.type === "text" && !part.synthetic && !command) agg.input += part.text
      if (part.type === "file") agg.parts.push(strip(part))
      return agg
    },
    { input: command ?? "", parts: [] as PromptInfo["parts"] },
  )
}
