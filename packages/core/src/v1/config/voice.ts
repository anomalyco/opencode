export * as ConfigVoiceV1 from "./voice"

import { Schema } from "effect"
import { PositiveInt } from "../../schema"

export const Whisper = Schema.Struct({
  url: Schema.optional(Schema.String).annotate({ description: "Whisper API URL" }),
  apiKey: Schema.optional(Schema.String).annotate({ description: "Whisper API key" }),
  model: Schema.optional(Schema.String).annotate({ description: "Whisper model name" }),
  language: Schema.optional(Schema.String).annotate({ description: "Whisper language code" }),
}).annotate({ identifier: "VoiceWhisperConfig" })
export type Whisper = Schema.Schema.Type<typeof Whisper>

export const Lalm = Schema.Struct({
  model: Schema.optional(Schema.String).annotate({
    description: "Model to use for audio transcription in the format of provider/model, eg openai/gpt-4o-audio-preview",
  }),
  system: Schema.optional(Schema.String).annotate({ description: "Large Audio Language Model system prompt" }),
  instruction: Schema.optional(Schema.String).annotate({
    description: "Instruction text appended after the audio content to guide transcription behavior",
  }),
  audio_input_format: Schema.optional(Schema.Literals(["input_audio", "audio_url"])).annotate({
    description:
      'Audio input format for the LLM API. "input_audio" (default) sends audio as OpenAI-style base64 parts. "audio_url" sends audio as data-URL parts compatible with SiliconFlow/Qwen-style APIs.',
  }),
}).annotate({ identifier: "VoiceLalmConfig" })
export type Lalm = Schema.Schema.Type<typeof Lalm>

export const Info = Schema.Struct({
  type: Schema.optional(Schema.Literals(["whisper", "lalm"])).annotate({
    description: "Transcription provider type",
  }),
  whisper: Schema.optional(Whisper).annotate({ description: "Whisper transcription settings" }),
  lalm: Schema.optional(Lalm).annotate({ description: "Large Audio Language Model transcription settings" }),
  hot_words: Schema.optional(Schema.String).annotate({
    description: "Comma-separated hot words to improve transcription accuracy for domain-specific terms",
  }),
  context_pairs: Schema.optional(PositiveInt).annotate({
    description: "Number of recent user/assistant conversation pairs to include as transcription context (default: 3)",
  }),
}).annotate({ identifier: "VoiceConfig" })
export type Info = Schema.Schema.Type<typeof Info>
