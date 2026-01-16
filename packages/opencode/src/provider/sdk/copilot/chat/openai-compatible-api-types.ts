import { JSONValue } from '@ai-sdk/provider';

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

export interface OpenAICompatibleSystemMessage extends JsonRecord {
  role: 'system';
  content: string;
}

export interface OpenAICompatibleUserMessage
  extends JsonRecord<OpenAICompatibleContentPart> {
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
  extends JsonRecord<OpenAICompatibleMessageToolCall> {
  role: 'assistant';
  content?: string | null;
  tool_calls?: Array<OpenAICompatibleMessageToolCall>;
}

export interface OpenAICompatibleMessageToolCall extends JsonRecord {
  type: 'function';
  id: string;
  function: {
    arguments: string;
    name: string;
  };
}

export interface OpenAICompatibleToolMessage extends JsonRecord {
  role: 'tool';
  content: string;
  tool_call_id: string;
}
