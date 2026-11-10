import { Decision } from "./decision.js"
import { Embedding } from "./embedding.js"
import { Image } from "./image.js"
import { LLM } from "./llm.js"
import { Speech } from "./speech.js"
import { Transcription } from "./transcription.js"
import { Video } from "./video.js"

/** The Effect API: the same shape as `ai` from `@opencode/ai`, returning `Effect` and `Stream`. */
export const ai = {
  request: LLM.request,
  generate: LLM.generate,
  stream: LLM.stream,
  loop: LLM.loop,
  collect: LLM.collect,
  compact: LLM.compact,
  canCompact: LLM.canCompact,
  image: Image,
  decision: Decision,
  embedding: Embedding,
  /** Experimental: may change without compatibility guarantees. */
  experimental: {
    speech: Speech,
    transcription: Transcription,
    video: Video,
  },
} as const

export { AIClient } from "./ai-client.js"
export { LLMClient } from "./route/client.js"
export { ImageClient } from "./image-client.js"
export { Auth } from "./route/auth.js"
export { ProviderPackage } from "./provider-package.js"
export type { LLMClientService } from "./route/client.js"
export { DecisionClient } from "./decision-client.js"
export { DecisionRoute } from "./route/decision.js"
export { EmbeddingClient } from "./embedding-client.js"
export { EmbeddingRoute } from "./route/embedding.js"
export { Generation } from "./generation.js"
export { ToolFailure, emptyInputJsonSchema, toDefinitions, tool } from "./tool.js"
export { ToolRuntime } from "./tool-runtime.js"
export type { DispatchResult as ToolDispatchResult, ToolSettlement } from "./tool-runtime.js"
export type {
  AnyExecutableTool,
  AnyTool,
  ExecutableTool,
  ExecutableTools,
  Definition as ToolShape,
  ToolExecute,
  ToolExecuteContext,
  ToolModelOutputInput,
  Tools,
  ToolSchema,
  ToolToModelOutput,
} from "./tool.js"
export * as LLM from "./llm.js"
export type {
  Definition as ProviderPackageDefinition,
  Settings as ProviderPackageSettings,
} from "./provider-package.js"
export { applySecretShield, isSecretShieldMode } from "./secret-shield.js"
export type { SecretShieldMode, ShieldResult, ShieldReport } from "./secret-shield.js"
