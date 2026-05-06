export { Adapter, LLMClient, modelCapabilities, modelLimits, modelRef, updateLLMRequest } from "./adapter"
export type {
  Adapter as AdapterShape,
  AdapterDefinition,
  AdapterInput,
  AdapterModelDefaults,
  AdapterModelInput,
  AdapterRoutedModelDefaults,
  AdapterRoutedModelInput,
  AnyAdapter,
  ClientOptions,
  HttpContext,
  LLMClient as LLMClientShape,
  ModelCapabilitiesInput,
  ModelRefInput,
} from "./adapter"
export * from "./executor"
export * from "./schema"
export * from "./tool-runtime"
export { Tool, ToolFailure, toDefinitions, tool } from "./tool"
export type { AnyTool, Tool as ToolShape, Tools, ToolSchema } from "./tool"

export { Auth } from "./auth"
export { Endpoint } from "./endpoint"
export { Framing } from "./framing"
export { Protocol } from "./protocol"
export type { Auth as AuthFn, AuthInput } from "./auth"
export type { Endpoint as EndpointFn, EndpointInput } from "./endpoint"
export type { Framing as FramingDef } from "./framing"
export type { Protocol as ProtocolDef } from "./protocol"

export * as LLM from "./llm"
export * as Providers from "./providers"
export * as Protocols from "./protocols"
export type { CapabilitiesInput } from "./llm"

// Provider facades are the normal user-facing entrypoints. Prefer importing
// them from `@opencode-ai/llm/providers` in application code.
export * as AmazonBedrock from "./providers/amazon-bedrock"
export * as Anthropic from "./providers/anthropic"
export * as Azure from "./providers/azure"
export * as Google from "./providers/google"
export * as GitHubCopilot from "./providers/github-copilot"
export * as OpenAI from "./providers/openai"
export * as OpenAICompatible from "./providers/openai-compatible"
export * as OpenRouter from "./providers/openrouter"
export * as XAI from "./providers/xai"

// Protocol modules expose low-level adapters, protocols, and payload types for
// tests, custom clients, and provider authors. Prefer
// `@opencode-ai/llm/protocols` for new advanced imports.
export * as AnthropicMessages from "./protocols/anthropic-messages"
export * as BedrockConverse from "./protocols/bedrock-converse"
export * as Gemini from "./protocols/gemini"
export * as OpenAIChat from "./protocols/openai-chat"
export * as OpenAICompatibleChat from "./protocols/openai-compatible-chat"
export * as OpenAIResponses from "./protocols/openai-responses"

// OpenAI-compatible profile metadata is shared by provider facades and advanced
// routing code; it is not a standalone runnable provider.
export * as OpenAICompatibleProfiles from "./providers/openai-compatible-profile"
