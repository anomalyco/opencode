export * as ConvertToClaudeMessage from "./convert-to-claude-message.js"

import type { LanguageModelV3FilePart, LanguageModelV3Prompt } from "@ai-sdk/provider"
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"
import { Fingerprint } from "../sync/fingerprint.js"

export type ContentBlock = Exclude<SDKUserMessage["message"]["content"], string>[number]

// Claude can't be given earlier turns, so their roles become text tags. Attachments stay real content blocks.
export function content(prompt: LanguageModelV3Prompt): ContentBlock[] {
  const blocks: ContentBlock[] = []
  const history = prompt.some((message) => message.role === "assistant" || message.role === "tool")
  for (const message of prompt) {
    if (message.role === "system") continue
    // OpenCode sends the files a tool returned as a user message after the tool result.
    const role = Fingerprint.isToolMedia(message) ? "tool" : message.role
    if (history) blocks.push({ type: "text", text: `<${role}>` })
    for (const part of message.content) {
      if (part.type === "text") {
        blocks.push({ type: "text", text: part.text })
        continue
      }
      if (part.type === "file") {
        const block = history ? past(file(part)) : file(part)
        // An image block has no field for a name.
        if (block.type === "image" && part.filename)
          blocks.push({ type: "text", text: `Attached image: ${part.filename}` })
        blocks.push(block.type === "document" && part.filename ? { ...block, title: part.filename } : block)
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
    if (history) blocks.push({ type: "text", text: `</${role}>` })
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
  // Throwing here would fail every later turn too, because the file stays in OpenCode's history.
  const name = part.filename ? `${part.filename} (${type})` : type
  return { type: "text", text: `[${name} was left out: Claude Code cannot read this file type.]` }
}

// Claude Code treats an image block in a user message as one the user just pasted: it saves a copy and adds an
// "[Image: source: ...]" line after the new prompt, so Claude takes an old image for a new attachment. An image inside a
// document block reaches Claude as it is.
function past(block: ContentBlock): ContentBlock {
  if (block.type !== "image") return block
  return { type: "document", source: { type: "content", content: [block] } }
}

function base64(data: string | Uint8Array) {
  if (typeof data === "string") return data
  return Buffer.from(data).toString("base64")
}
