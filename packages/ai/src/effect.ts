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
export { isContextOverflow, isContextOverflowFailure, isRetryable } from "./provider-error.js"
export type { LLMClientService } from "./route/client.js"
export {
  ProtocolID,
  RouteID,
  ModelID,
  ProviderID,
  ResponseID,
  ContentBlockID,
  ToolCallID,
  JsonSchema,
  ProviderOptions,
  ProviderMetadata,
  HttpTimeout,
  RequestEncoding,
  HttpOptions,
  GenerationOptions,
  LanguageModelDefaults,
  ReasoningEfforts,
  ReasoningEffort,
  LanguageModelCompatibility,
  LanguageModel,
  LanguageModelSchema,
  CacheTTL,
  CacheHint,
  CachePolicyObject,
  CachePolicy,
  MessageRole,
  SystemPart,
  TextPart,
  MediaPart,
  ToolResultValue,
  ToolOutput,
  ToolCallPart,
  ToolResultPart,
  ReasoningPart,
  CompactionPart,
  EffortPart,
  ContentPart,
  Message,
  Freeform,
  ToolDefinition,
  ToolNamespace,
  ToolEntry,
  ToolChoice,
  LLMRequest,
  FinishReason,
  Usage,
  MediaUsage,
  CompactionResponse,
  CompactionCheckpointResponse,
  StepStart,
  TextStart,
  TextDelta,
  TextEnd,
  ReasoningStart,
  ReasoningDelta,
  ReasoningEnd,
  ToolInputStart,
  ToolInputDelta,
  ToolInputEnd,
  ToolInputError,
  ToolCall,
  ToolResult,
  ToolError,
  FinishReasonDetails,
  StepFinish,
  Finish,
  MediaEvent,
  ProviderErrorEvent,
  LLMEvent,
  LLMResponse,
  HttpContext,
  HttpRateLimitDetails,
  InvalidRequestError,
  UnsupportedOperationError,
  ProviderConfigurationError,
  AuthenticationError,
  RateLimitError,
  QuotaExceededError,
  ContentPolicyError,
  ProviderInternalError,
  TransportType,
  TransportOperation,
  TransportError,
  InvalidProviderOutputError,
  UnknownProviderError,
  TimeoutError,
  AIErrorReason,
  AIError,
} from "./schema/index.js"
export type {
  GenerationOptionsFields,
  GenerationOptionsInput,
  LanguageModelInput,
  LanguageModelProviderOptions,
  ToolDefinitionInput,
  ToolNamespaceInput,
  ToolNamespaceEntryInput,
  ToolEntryInput,
  UsageInput,
} from "./schema/index.js"
export { ImageAspectRatio, ImageEvent, ImageModel, ImageModelSchema, ImageRequest, ImageResponse } from "./image.js"
export type {
  ImageModelOptions,
  ImageOptions,
  ImageRequestFor,
  ImageRequestInput,
  ImageResolution,
  ImageRoute,
} from "./image.js"
export { DecisionClient } from "./decision-client.js"
export {
  ChoiceAnswer,
  ChoiceQuestion,
  ChoiceValue,
  DecisionAnswer,
  DecisionJsonPart,
  DecisionMediaPart,
  DecisionModel,
  DecisionModelCompatibility,
  DecisionModelSchema,
  DecisionPart,
  DecisionQuestion,
  DecisionRequest,
  DecisionResponse,
  DecisionTextPart,
  DecisionUsage,
  ErrorAnswer,
  ErrorReason,
  PredicateAnswer,
  PredicateQuestion,
  ScoreAnswer,
  ScoreQuestion,
} from "./decision.js"
export type {
  AnswerFor,
  AnswersFor,
  DecisionInput,
  DecisionModelOptions,
  DecisionOptions,
  DecisionQuestions,
  DecisionRequestFor,
  DecisionRequestInput,
  DecisionResponseFor,
  DecisionModelRoute,
} from "./decision.js"
export { DecisionRoute } from "./route/decision.js"
export { Media } from "./media.js"
export { Generation } from "./generation.js"
export type {
  AwaitOptions as GenerationAwaitOptions,
  Event as GenerationEvent,
  Poll,
  Route as GenerationRoute,
  Snapshot as GenerationSnapshot,
  Status as GenerationStatus,
} from "./generation.js"
export { ToolFailure, emptyInputJsonSchema, toDefinitions, tool } from "./tool.js"
export { ToolRuntime } from "./tool-runtime.js"
export type { ToolSettlement } from "./tool-runtime.js"
export type {
  ExecutableTool,
  Tool,
  ToolExecute,
  ToolExecuteContext,
  ToolModelOutputInput,
  ToolOptions,
  ToolSchema,
  ToolToModelOutput,
} from "./tool.js"
export type { LLM } from "./llm.js"
