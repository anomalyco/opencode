import { Message, ToolCallPart, type ContentPart, type ToolResultContentPart } from "@opencode-ai/llm"
import { SessionMessage } from "../message"
import type { FileAttachment } from "../prompt"

const media = (file: FileAttachment): ContentPart => ({
  type: "media",
  mediaType: file.mime,
  data: file.uri,
  filename: file.name,
  metadata: file.description === undefined ? undefined : { description: file.description },
})

const toolOutput = (content: SessionMessage.ToolStateCompleted["content"]): ToolResultContentPart[] =>
  content.map((item) =>
    item.type === "text"
      ? { type: "text", text: item.text }
      : { type: "media", mediaType: item.mime, data: item.uri, filename: item.name })

const toolInput = (tool: SessionMessage.AssistantTool) => {
  if (tool.state.status !== "pending") return tool.state.input
  try {
    return JSON.parse(tool.state.input) as unknown
  } catch {
    return tool.state.input
  }
}

const toolCall = (tool: SessionMessage.AssistantTool): ContentPart =>
  ToolCallPart.make({
    id: tool.id,
    name: tool.name,
    input: toolInput(tool),
    providerExecuted: tool.provider?.executed,
    providerMetadata: tool.provider?.metadata,
  })

const toolResult = (tool: SessionMessage.AssistantTool) => {
  if (tool.state.status === "completed") {
    const content = toolOutput(tool.state.content)
    return Message.tool({
      id: tool.id,
      name: tool.name,
      result: content.length > 0 ? content : tool.state.structured,
      resultType: content.length > 0 ? "content" : "json",
      providerExecuted: tool.provider?.executed,
      providerMetadata: tool.provider?.metadata,
    })
  }
  if (tool.state.status === "error") {
    return Message.tool({
      id: tool.id,
      name: tool.name,
      result: { error: tool.state.error, content: tool.state.content, structured: tool.state.structured },
      resultType: "error",
      providerExecuted: tool.provider?.executed,
      providerMetadata: tool.provider?.metadata,
    })
  }
}

const assistant = (message: SessionMessage.Assistant) => {
  const content = message.content.map((item): ContentPart => {
    if (item.type === "text") return { type: "text", text: item.text }
    if (item.type === "reasoning") return { type: "reasoning", text: item.text }
    return toolCall(item)
  })
  const results = message.content
    .filter((item): item is SessionMessage.AssistantTool => item.type === "tool")
    .map(toolResult)
    .filter((message) => message !== undefined)
  return [Message.make({ id: message.id, role: "assistant", content, metadata: message.metadata }), ...results]
}

function toLLMMessage(message: SessionMessage.Message): Message[] {
  switch (message.type) {
    case "agent-switched":
    case "model-switched":
      return []
    case "user":
      return [
        Message.make({
          id: message.id,
          role: "user",
          content: [{ type: "text", text: message.text }, ...(message.files ?? []).map(media)],
          metadata: {
            ...message.metadata,
            ...(message.agents?.length ? { agents: message.agents } : {}),
            ...(message.references?.length ? { references: message.references } : {}),
          },
        }),
      ]
    case "synthetic":
      return [Message.make({ id: message.id, role: "user", content: message.text, metadata: message.metadata })]
    case "shell":
      return [
        Message.make({
          id: message.id,
          role: "user",
          content: `Shell command: ${message.command}\n\n${message.output}`,
          metadata: message.metadata,
        }),
      ]
    case "assistant":
      return assistant(message)
    case "compaction":
      return [
        Message.make({
          id: message.id,
          role: "user",
          content: `Summary of earlier conversation:\n${message.summary}`,
          metadata: message.metadata,
        }),
      ]
  }
}

/** Translate projected V2 Session history into canonical @opencode-ai/llm context. */
export const toLLMMessages = (messages: readonly SessionMessage.Message[]) => messages.flatMap(toLLMMessage)
