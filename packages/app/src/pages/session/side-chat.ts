import type { Prompt } from "@/context/prompt"

export const SIDE_CHAT_TAB_PREFIX = "side-chat://"

export type SideChatTab = {
  tabID: string
  ordinal: number
  parentID: string
  sessionID?: string
  creating: boolean
  initialMessageIDs: string[]
  initialPrompt?: string
}

export const isSideChatTab = (tab: string | undefined): tab is string => !!tab?.startsWith(SIDE_CHAT_TAB_PREFIX)

export function excludeSideChatHistory<T extends { id: string }>(
  messages: T[],
  initialMessageIDs: ReadonlySet<string> | undefined,
) {
  if (!initialMessageIDs?.size) return messages
  return messages.filter((message) => !initialMessageIDs.has(message.id))
}

export function quoteSelection(source: string, value: string) {
  const text = value.replace(/\r\n?/g, "\n").trim()
  if (!text) return ""
  const quote = text
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n")
  return `${source}:\n${quote}\n\n`
}

export function appendPromptText(prompt: Prompt, value: string) {
  if (!value) return { prompt, cursor: Math.max(0, ...prompt.map((part) => ("end" in part ? part.end : 0))) }

  const parts = prompt.filter((part) => part.type !== "text" || part.content.length > 0)
  const end = Math.max(0, ...parts.map((part) => ("end" in part ? part.end : 0)))
  const content = `${end > 0 ? "\n\n" : ""}${value}`
  const next: Prompt = [...parts, { type: "text", content, start: end, end: end + content.length }]
  return { prompt: next, cursor: end + content.length }
}
