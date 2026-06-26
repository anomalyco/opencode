import type { JSONValue } from "@ai-sdk/provider"

export type OpenAICompatibleChatPrompt = Array<OpenAICompatibleMessage>

export type OpenAICompatibleMessage =
  | OpenAICompatibleSystemMessage
  | OpenAICompatibleUserMessage
  | OpenAICompatibleAssistantMessage
  | OpenAICompatibleToolMessage

// Allow for arbitrary additional properties for general purpose
// provider-metadata-specific extensibility.
type JsonRecord<T = never> = Record<string, JSONValue | JSONValue[] | T | T[] | undefined>

export interface OpenAICompatibleSystemMessage extends JsonRecord<OpenAICompatibleSystemContentPart> {
  role: "system"
  content: string | Array<OpenAICompatibleSystemContentPart>
}

export interface OpenAICompatibleSystemContentPart extends JsonRecord {
  type: "text"
  text: string
}

export interface OpenAICompatibleUserMessage extends JsonRecord<OpenAICompatibleContentPart> {
  role: "user"
  content: string | Array<OpenAICompatibleContentPart>
}

export type OpenAICompatibleContentPart =
  | OpenAICompatibleContentPartText
  | OpenAICompatibleContentPartImage
  | OpenAICompatibleContentPartVideo
  | OpenAICompatibleContentPartAudio
  | OpenAICompatibleContentPartFile

export interface OpenAICompatibleContentPartImage extends JsonRecord {
  type: "image_url"
  image_url: { url: string }
}

export interface OpenAICompatibleContentPartText extends JsonRecord {
  type: "text"
  text: string
}

export interface OpenAICompatibleContentPartVideo extends JsonRecord {
  type: "video_url"
  video_url: { url: string }
}

export interface OpenAICompatibleContentPartAudio extends JsonRecord {
  type: "input_audio"
  input_audio: { data: string; format: string }
}

export interface OpenAICompatibleContentPartFile extends JsonRecord {
  type: "file"
  file: { filename?: string; file_data: string }
}

export interface OpenAICompatibleAssistantMessage extends JsonRecord<OpenAICompatibleMessageToolCall> {
  role: "assistant"
  content?: string | null
  tool_calls?: Array<OpenAICompatibleMessageToolCall>
  // Copilot-specific reasoning fields
  reasoning_text?: string
  reasoning_opaque?: string
  // OpenAI-compatible reasoning field for non-Copilot providers
  reasoning_content?: string
}

export interface OpenAICompatibleMessageToolCall extends JsonRecord {
  type: "function"
  id: string
  function: {
    arguments: string
    name: string
  }
}

export interface OpenAICompatibleToolMessage extends JsonRecord {
  role: "tool"
  content: string
  tool_call_id: string
}
