export { Adapter, LLMClient, modelCapabilities, modelLimits, modelRef } from "./adapter"
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
export * from "./patch"
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
export * as ProviderPatch from "./provider-patch"
export * as Providers from "./providers"
export * as Protocols from "./protocols"
export type { CapabilitiesInput } from "./llm"

// Provider facades are the normal user-facing entrypoints. Prefer importing
// them from `@opencode-ai/llm/providers` in application code.
export { AmazonBedrock } from "./providers/amazon-bedrock"
export { Anthropic } from "./providers/anthropic"
export { Azure } from "./providers/azure"
export { Google } from "./providers/google"
export { GitHubCopilot } from "./providers/github-copilot"
export { OpenAI } from "./providers/openai"
export { OpenAICompatible } from "./providers/openai-compatible"
export { OpenRouter } from "./providers/openrouter"
export { XAI } from "./providers/xai"

// Protocol modules expose low-level adapters, protocols, and payload types for
// tests, custom clients, and provider authors. Prefer
// `@opencode-ai/llm/protocols` for new advanced imports.
export { AnthropicMessages } from "./protocols/anthropic-messages"
export { BedrockConverse } from "./protocols/bedrock-converse"
export { Gemini } from "./protocols/gemini"
export { OpenAIChat } from "./protocols/openai-chat"
export { OpenAICompatibleChat } from "./protocols/openai-compatible-chat"
export { OpenAIResponses } from "./protocols/openai-responses"

// OpenAI-compatible metadata helpers are shared by provider facades and
// advanced routing code; they are not standalone runnable providers.
export { OpenAICompatibleFamily } from "./providers/openai-compatible-family"
export { OpenAICompatibleProfiles } from "./providers/openai-compatible-profile"
