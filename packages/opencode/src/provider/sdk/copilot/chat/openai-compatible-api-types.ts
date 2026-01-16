import type { JSONValue } from '@ai-sdk/provider';

export type OpenAICompatibleChatPrompt = Array<OpenAICompatibleMessage>;

export type OpenAICompatibleMessage =
  | OpenAICompatibleSystemMessage
  | OpenAICompatibleUserMessage
  | OpenAICompatibleAssistantMessage
  | OpenAICompatibleToolMessage;

// Allow for arbitrary additional properties for general purpose
// provider-metadata-specific extensibility.
type JsonRecord<T = never> = Record<
  string,
  JSONValue | JSONValue[] | T | T[] | undefined
>;

// Copilot-specific cache control type
type CopilotCacheControl = { copilot_cache_control?: { type: 'ephemeral' } };

export interface OpenAICompatibleSystemMessage
  extends JsonRecord<OpenAICompatibleSystemContentPart> {
  role: 'system';
  content: string | Array<OpenAICompatibleSystemContentPart>;
}

export interface OpenAICompatibleSystemContentPart
  extends JsonRecord,
    CopilotCacheControl {
  type: 'text';
  text: string;
}

export interface OpenAICompatibleUserMessage
  extends JsonRecord<OpenAICompatibleContentPart>,
    CopilotCacheControl {
  role: 'user';
  content: string | Array<OpenAICompatibleContentPart>;
}

export type OpenAICompatibleContentPart =
  | OpenAICompatibleContentPartText
  | OpenAICompatibleContentPartImage;

export interface OpenAICompatibleContentPartImage extends JsonRecord {
  type: 'image_url';
  image_url: { url: string };
}

export interface OpenAICompatibleContentPartText extends JsonRecord {
  type: 'text';
  text: string;
}

export interface OpenAICompatibleAssistantMessage
  extends JsonRecord<OpenAICompatibleMessageToolCall>,
    CopilotCacheControl {
  role: 'assistant';
  content?: string | null;
  tool_calls?: Array<OpenAICompatibleMessageToolCall>;
  // Copilot-specific reasoning fields
  reasoning_text?: string;
  reasoning_opaque?: string;
}

export interface OpenAICompatibleMessageToolCall extends JsonRecord {
  type: 'function';
  id: string;
  function: {
    arguments: string;
    name: string;
  };
}

export interface OpenAICompatibleToolMessage
  extends JsonRecord,
    CopilotCacheControl {
  role: 'tool';
  content: string;
  tool_call_id: string;
}
