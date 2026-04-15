import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"
import { SessionID } from "@/session/schema"
import { ProviderID, ModelID, Usage } from "@opencode-ai/llm"

const LalmVoiceOverride = Schema.Struct({
  model: Schema.optional(Schema.Struct({
    providerID: ProviderID,
    modelID: ModelID,
  })).annotate({ description: "LALM model to use (structured provider/model reference)" }),
  system: Schema.optional(Schema.String).annotate({ description: "Large Audio Language Model system prompt" }),
  instruction: Schema.optional(Schema.String).annotate({ description: "Instruction text appended after the audio content to guide transcription behavior" }),
  audio_input_format: Schema.optional(Schema.Literals(["input_audio", "audio_url"])).annotate({
    description:
      'Audio input format for the LLM API. "input_audio" (default) sends audio as OpenAI-style base64 parts. "audio_url" sends audio as data-URL parts (SiliconFlow/Qwen-style APIs).',
  }),
})

const WhisperVoiceOverride = Schema.Struct({
  url: Schema.optional(Schema.String).annotate({ description: "Whisper API URL" }),
  apiKey: Schema.optional(Schema.String).annotate({ description: "Whisper API key" }),
  model: Schema.optional(Schema.String).annotate({ description: "Whisper model name" }),
  language: Schema.optional(Schema.String).annotate({ description: "Whisper language code" }),
})

const VoiceOverride = Schema.Struct({
  type: Schema.optional(Schema.Literals(["whisper", "lalm"])).annotate({
    description: "Transcription provider type (defaults to server config)",
  }),
  whisper: Schema.optional(WhisperVoiceOverride).annotate({
    description: "Whisper transcription settings (overrides server config)",
  }),
  lalm: Schema.optional(LalmVoiceOverride).annotate({
    description: "Large Audio Language Model transcription settings (overrides server config)",
  }),
  hot_words: Schema.optional(Schema.String).annotate({ description: "Comma-separated hot words to improve transcription accuracy for domain-specific terms" }),
}).annotate({ description: "Voice transcription settings override" })

export const TranscribeRequest = Schema.Struct({
  audio: Schema.String,
  mime: Schema.String,
  prompt: Schema.optional(Schema.String).annotate({
    description: "Extra prompt text (e.g. input box content) appended after server-built context",
  }),
  sessionID: Schema.optional(SessionID).annotate({
    description: "Session ID to build conversation context from (directory, branch, recent messages)",
  }),
  images: Schema.optional(Schema.Array(Schema.String)).annotate({
    description:
      "Images to provide visual context for transcription. Each entry must be a data URL (data:image/...;base64,...).",
  }),
  voice: Schema.optional(VoiceOverride),
})

const TranscribeResponse = Schema.Struct({
  text: Schema.String,
  usage: Schema.optional(Usage),
})

export class AudioApiError extends Schema.ErrorClass<AudioApiError>("AudioError")(
  {
    name: Schema.Literal("AudioError"),
    data: Schema.Struct({
      message: Schema.String,
    }),
  },
  { httpApiStatus: 400 },
) {}

export const AudioApi = HttpApi.make("audio")
  .add(
    HttpApiGroup.make("audio")
      .add(
        HttpApiEndpoint.post("transcribe", "/voice/transcribe", {
          query: WorkspaceRoutingQuery,
          payload: TranscribeRequest,
          success: described(TranscribeResponse, "Transcription result"),
          error: AudioApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "audio.transcribe",
            summary: "Transcribe audio",
            description:
              "Transcribe base64-encoded audio data with Whisper or an audio language model",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "audio",
          description: "Audio transcription routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "audio",
      version: "0.0.1",
      description: "Audio transcription routes.",
    }),
  )
