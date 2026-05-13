import { type LanguageModelV2Prompt } from "@ai-sdk/provider";
import type { OpenAICompatibleChatPrompt } from "./openai-compatible-api-types";
export declare function convertToOpenAICompatibleChatMessages(prompt: LanguageModelV2Prompt): OpenAICompatibleChatPrompt;
