import { Decision } from "./decision.js"
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
export { Generation } from "./generation.js"
export { ToolFailure, emptyInputJsonSchema, toDefinitions, tool } from "./tool.js"
export { ToolRuntime } from "./tool-runtime.js"
export type { ToolSettlement } from "./tool-runtime.js"
export * from "./public.js"
