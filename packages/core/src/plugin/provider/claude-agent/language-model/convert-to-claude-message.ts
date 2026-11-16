export * as ConvertToClaudeMessage from "./convert-to-claude-message.js"

import type { LanguageModelV3FilePart, LanguageModelV3Prompt } from "@ai-sdk/provider"
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"

export type ContentBlock = Exclude<SDKUserMessage["message"]["content"], string>[number]

// Claude can't be given earlier turns, so their roles become text tags. Attachments stay real content blocks.
export function content(prompt: LanguageModelV3Prompt): ContentBlock[] {
  const blocks: ContentBlock[] = []
  const history = prompt.some((message) => message.role === "assistant" || message.role === "tool")
  for (const message of prompt) {
    if (message.role === "system") continue
    if (history) blocks.push({ type: "text", text: `<${message.role}>` })
    for (const part of message.content) {
      if (part.type === "text") {
        blocks.push({ type: "text", text: part.text })
        continue
      }
      if (part.type === "file") {
        blocks.push(file(part))
        continue
      }
      if (part.type === "tool-call") {
        const call = JSON.stringify({ id: part.toolCallId, name: part.toolName, input: part.input })
        blocks.push({ type: "text", text: `<tool-call>\n${call}\n</tool-call>` })
        continue
      }
      if (part.type === "tool-result") {
        const result = JSON.stringify({ id: part.toolCallId, name: part.toolName, output: part.output })
        blocks.push({ type: "text", text: `<tool-result>\n${result}\n</tool-result>` })
      }
    }
    if (history) blocks.push({ type: "text", text: `</${message.role}>` })
  }
  return blocks
}

function file(part: LanguageModelV3FilePart): ContentBlock {
  const type = part.mediaType
  if (type === "application/pdf") {
    if (part.data instanceof URL) return { type: "document", source: { type: "url", url: part.data.href } }
    return { type: "document", source: { type: "base64", media_type: type, data: base64(part.data) } }
  }
  if (type === "image/png" || type === "image/jpeg" || type === "image/gif" || type === "image/webp") {
    if (part.data instanceof URL) return { type: "image", source: { type: "url", url: part.data.href } }
    return { type: "image", source: { type: "base64", media_type: type, data: base64(part.data) } }
  }
  throw new Error(`Claude Code does not support ${type} attachments`)
}

function base64(data: string | Uint8Array) {
  if (typeof data === "string") return data
  return Buffer.from(data).toString("base64")
}
