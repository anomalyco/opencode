export * as Fingerprint from "./fingerprint.js"

import { createHash } from "node:crypto"
import type { LanguageModelV3Message, LanguageModelV3Prompt } from "@ai-sdk/provider"

export interface Group {
  readonly hash: string
  readonly role: "user" | "assistant" | "tool"
  readonly start: number
  readonly end: number
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>
    const fields: string[] = []
    for (const key of Object.keys(object).sort()) {
      if (object[key] !== undefined) fields.push(`${JSON.stringify(key)}:${canonical(object[key])}`)
    }
    return `{${fields.join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

function hash(value: unknown) {
  return createHash("sha256").update(canonical(value)).digest("hex")
}

// opencode sends thinking and provider options differently depending on the target model, so they don't count.
function visible(message: Exclude<LanguageModelV3Message, { role: "system" }>) {
  const parts: unknown[] = []
  let text = ""
  for (const part of message.content) {
    if (part.type === "reasoning") continue
    if (part.type === "text") {
      text += part.text
      continue
    }
    if (text) parts.push({ type: "text", text })
    text = ""
    if (part.type === "file") {
      const data =
        part.data instanceof URL
          ? part.data.href
          : typeof part.data === "string"
            ? part.data
            : Buffer.from(part.data).toString("base64")
      parts.push({ type: part.type, mediaType: part.mediaType, data })
      continue
    }
    if (part.type === "tool-call") {
      parts.push({ type: part.type, id: part.toolCallId, name: part.toolName, input: part.input })
      continue
    }
    if (part.type === "tool-result") {
      const output = { ...part.output }
      if ("providerOptions" in output) delete output.providerOptions
      if (output.type === "content") {
        output.value = output.value.map((part) => {
          const item = { ...part }
          delete item.providerOptions
          return item
        })
      }
      parts.push({ type: part.type, id: part.toolCallId, name: part.toolName, output })
    }
  }
  if (text) parts.push({ type: "text", text })
  return parts
}

// OpenCode lowers tool attachments into this separate user message.
function isToolMedia(message: LanguageModelV3Message) {
  return (
    message.role === "user" &&
    message.content.length > 1 &&
    message.content[0]?.type === "text" &&
    message.content[0].text === "Attached media from tool result:" &&
    message.content.slice(1).every((part) => part.type === "file")
  )
}

export function groups(prompt: LanguageModelV3Prompt): Group[] {
  const groups: Group[] = []
  let i = 0
  while (i < prompt.length) {
    const message = prompt[i]!
    const start = i
    i++
    if (message.role === "system") continue
    const parts = visible(message)
    if (parts.length === 0) continue
    const members = [hash(parts)]
    if (message.role === "user") {
      while (i < prompt.length) {
        const next = prompt[i]!
        if (next.role !== "user") break
        members.push(hash(visible(next)))
        i++
      }
      members.sort()
    }
    if (message.role === "tool") {
      const next = prompt[i]
      if (next && next.role === "user" && isToolMedia(next)) {
        members.push(hash(visible(next)))
        i++
      }
    }
    groups.push({ hash: hash({ role: message.role, members }), role: message.role, start, end: i })
  }
  return groups
}
