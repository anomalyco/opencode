/**
 * OpenAI Realtime API Protocol Types
 *
 * Zod schemas for all client and server WebSocket events.
 * Based on: https://platform.openai.com/docs/api-reference/realtime
 */
import z from "zod"

export namespace RealtimeProtocol {
  // ============================================================================
  // Common Types
  // ============================================================================

  export const AudioFormat = z.enum(["pcm16", "g711_ulaw", "g711_alaw"])
  export type AudioFormat = z.infer<typeof AudioFormat>

  export const Voice = z.enum(["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"])
  export type Voice = z.infer<typeof Voice>

  export const TurnDetectionType = z.enum(["server_vad", "semantic_vad", "none"])
  export type TurnDetectionType = z.infer<typeof TurnDetectionType>

  export const ServerVadConfig = z.object({
    type: z.literal("server_vad"),
    threshold: z.number().min(0).max(1).optional(),
    prefix_padding_ms: z.number().int().positive().optional(),
    silence_duration_ms: z.number().int().positive().optional(),
    create_response: z.boolean().optional(),
    interrupt_response: z.boolean().optional(),
    idle_timeout_ms: z.number().int().positive().optional(),
  })
  export type ServerVadConfig = z.infer<typeof ServerVadConfig>

  export const SemanticVadConfig = z.object({
    type: z.literal("semantic_vad"),
    eagerness: z.enum(["low", "medium", "high"]).optional(),
  })
  export type SemanticVadConfig = z.infer<typeof SemanticVadConfig>

  export const NoVadConfig = z.object({
    type: z.literal("none"),
  })
  export type NoVadConfig = z.infer<typeof NoVadConfig>

  export const TurnDetection = z.discriminatedUnion("type", [ServerVadConfig, SemanticVadConfig, NoVadConfig])
  export type TurnDetection = z.infer<typeof TurnDetection>

  export const Tool = z.object({
    type: z.literal("function"),
    name: z.string(),
    description: z.string().optional(),
    parameters: z.record(z.string(), z.any()),
  })
  export type Tool = z.infer<typeof Tool>

  export const SessionConfig = z.object({
    type: z.literal("realtime").optional(),
    modalities: z.array(z.enum(["text", "audio"])).optional(),
    voice: Voice.optional(),
    instructions: z.string().optional(),
    input_audio_format: AudioFormat.optional(),
    output_audio_format: AudioFormat.optional(),
    input_audio_transcription: z
      .object({
        model: z.string(),
      })
      .optional(),
    turn_detection: TurnDetection.nullable().optional(),
    tools: z.array(Tool).optional(),
    tool_choice: z.union([z.literal("auto"), z.literal("none"), z.literal("required"), z.string()]).optional(),
    temperature: z.number().min(0).max(2).optional(),
    max_response_output_tokens: z.union([z.number().int().positive(), z.literal("inf")]).optional(),
  })
  export type SessionConfig = z.infer<typeof SessionConfig>

  // ============================================================================
  // Client Events (Client → Server)
  // ============================================================================

  export const SessionUpdate = z.object({
    type: z.literal("session.update"),
    session: SessionConfig,
  })
  export type SessionUpdate = z.infer<typeof SessionUpdate>

  export const InputAudioBufferAppend = z.object({
    type: z.literal("input_audio_buffer.append"),
    audio: z.string(), // base64-encoded audio
  })
  export type InputAudioBufferAppend = z.infer<typeof InputAudioBufferAppend>

  export const InputAudioBufferCommit = z.object({
    type: z.literal("input_audio_buffer.commit"),
  })
  export type InputAudioBufferCommit = z.infer<typeof InputAudioBufferCommit>

  export const InputAudioBufferClear = z.object({
    type: z.literal("input_audio_buffer.clear"),
  })
  export type InputAudioBufferClear = z.infer<typeof InputAudioBufferClear>

  export const ResponseCreate = z.object({
    type: z.literal("response.create"),
    response: z
      .object({
        modalities: z.array(z.enum(["text", "audio"])).optional(),
        instructions: z.string().optional(),
        voice: Voice.optional(),
        tools: z.array(Tool).optional(),
        tool_choice: z.union([z.literal("auto"), z.literal("none"), z.literal("required"), z.string()]).optional(),
        temperature: z.number().min(0).max(2).optional(),
        max_response_output_tokens: z.union([z.number().int().positive(), z.literal("inf")]).optional(),
      })
      .optional(),
  })
  export type ResponseCreate = z.infer<typeof ResponseCreate>

  export const ResponseCancel = z.object({
    type: z.literal("response.cancel"),
  })
  export type ResponseCancel = z.infer<typeof ResponseCancel>

  export const ConversationItemCreate = z.object({
    type: z.literal("conversation.item.create"),
    item: z.object({
      type: z.literal("function_call_output"),
      call_id: z.string(),
      output: z.string(),
    }),
  })
  export type ConversationItemCreate = z.infer<typeof ConversationItemCreate>

  export const ClientEvent = z.discriminatedUnion("type", [
    SessionUpdate,
    InputAudioBufferAppend,
    InputAudioBufferCommit,
    InputAudioBufferClear,
    ResponseCreate,
    ResponseCancel,
    ConversationItemCreate,
  ])
  export type ClientEvent = z.infer<typeof ClientEvent>

  // ============================================================================
  // Server Events (Server → Client)
  // ============================================================================

  export const ErrorEvent = z.object({
    type: z.literal("error"),
    error: z.object({
      type: z.string(),
      code: z.string().optional(),
      message: z.string(),
      param: z.string().nullable().optional(),
      event_id: z.string().optional(),
    }),
  })
  export type ErrorEvent = z.infer<typeof ErrorEvent>

  export const SessionCreated = z.object({
    type: z.literal("session.created"),
    session: SessionConfig,
  })
  export type SessionCreated = z.infer<typeof SessionCreated>

  export const SessionUpdated = z.object({
    type: z.literal("session.updated"),
    session: SessionConfig,
  })
  export type SessionUpdated = z.infer<typeof SessionUpdated>

  export const InputAudioBufferSpeechStarted = z.object({
    type: z.literal("input_audio_buffer.speech_started"),
    audio_start_ms: z.number(),
    item_id: z.string(),
  })
  export type InputAudioBufferSpeechStarted = z.infer<typeof InputAudioBufferSpeechStarted>

  export const InputAudioBufferSpeechStopped = z.object({
    type: z.literal("input_audio_buffer.speech_stopped"),
    audio_end_ms: z.number(),
    item_id: z.string(),
  })
  export type InputAudioBufferSpeechStopped = z.infer<typeof InputAudioBufferSpeechStopped>

  export const InputAudioBufferCommitted = z.object({
    type: z.literal("input_audio_buffer.committed"),
    previous_item_id: z.string().nullable().optional(),
    item_id: z.string(),
  })
  export type InputAudioBufferCommitted = z.infer<typeof InputAudioBufferCommitted>

  export const ConversationItemInputAudioTranscriptionCompleted = z.object({
    type: z.literal("conversation.item.input_audio_transcription.completed"),
    item_id: z.string(),
    content_index: z.number(),
    transcript: z.string(),
  })
  export type ConversationItemInputAudioTranscriptionCompleted = z.infer<
    typeof ConversationItemInputAudioTranscriptionCompleted
  >

  export const ResponseCreated = z.object({
    type: z.literal("response.created"),
    response: z.object({
      id: z.string(),
      status: z.string(),
      output: z.array(z.any()),
    }),
  })
  export type ResponseCreated = z.infer<typeof ResponseCreated>

  export const ResponseAudioDelta = z.object({
    type: z.literal("response.audio.delta"),
    response_id: z.string(),
    item_id: z.string(),
    output_index: z.number(),
    content_index: z.number(),
    delta: z.string(), // base64-encoded audio
  })
  export type ResponseAudioDelta = z.infer<typeof ResponseAudioDelta>

  export const ResponseAudioDone = z.object({
    type: z.literal("response.audio.done"),
    response_id: z.string(),
    item_id: z.string(),
    output_index: z.number(),
    content_index: z.number(),
  })
  export type ResponseAudioDone = z.infer<typeof ResponseAudioDone>

  export const ResponseAudioTranscriptDelta = z.object({
    type: z.literal("response.audio_transcript.delta"),
    response_id: z.string(),
    item_id: z.string(),
    output_index: z.number(),
    content_index: z.number(),
    delta: z.string(),
  })
  export type ResponseAudioTranscriptDelta = z.infer<typeof ResponseAudioTranscriptDelta>

  export const ResponseAudioTranscriptDone = z.object({
    type: z.literal("response.audio_transcript.done"),
    response_id: z.string(),
    item_id: z.string(),
    output_index: z.number(),
    content_index: z.number(),
    transcript: z.string(),
  })
  export type ResponseAudioTranscriptDone = z.infer<typeof ResponseAudioTranscriptDone>

  export const ResponseFunctionCallArgumentsDelta = z.object({
    type: z.literal("response.function_call_arguments.delta"),
    response_id: z.string(),
    item_id: z.string(),
    output_index: z.number(),
    call_id: z.string(),
    delta: z.string(),
  })
  export type ResponseFunctionCallArgumentsDelta = z.infer<typeof ResponseFunctionCallArgumentsDelta>

  export const ResponseFunctionCallArgumentsDone = z.object({
    type: z.literal("response.function_call_arguments.done"),
    response_id: z.string(),
    item_id: z.string(),
    output_index: z.number(),
    call_id: z.string(),
    name: z.string(),
    arguments: z.string(),
  })
  export type ResponseFunctionCallArgumentsDone = z.infer<typeof ResponseFunctionCallArgumentsDone>

  export const ResponseDone = z.object({
    type: z.literal("response.done"),
    response: z.object({
      id: z.string(),
      status: z.string(),
      usage: z
        .object({
          total_tokens: z.number(),
          input_tokens: z.number(),
          output_tokens: z.number(),
          input_token_details: z
            .object({
              text_tokens: z.number().optional(),
              audio_tokens: z.number().optional(),
              cached_tokens: z.number().optional(),
            })
            .optional(),
          output_token_details: z
            .object({
              text_tokens: z.number().optional(),
              audio_tokens: z.number().optional(),
            })
            .optional(),
        })
        .optional(),
    }),
  })
  export type ResponseDone = z.infer<typeof ResponseDone>

  export const ServerEvent = z.discriminatedUnion("type", [
    ErrorEvent,
    SessionCreated,
    SessionUpdated,
    InputAudioBufferSpeechStarted,
    InputAudioBufferSpeechStopped,
    InputAudioBufferCommitted,
    ConversationItemInputAudioTranscriptionCompleted,
    ResponseCreated,
    ResponseAudioDelta,
    ResponseAudioDone,
    ResponseAudioTranscriptDelta,
    ResponseAudioTranscriptDone,
    ResponseFunctionCallArgumentsDelta,
    ResponseFunctionCallArgumentsDone,
    ResponseDone,
  ])
  export type ServerEvent = z.infer<typeof ServerEvent>

  // ============================================================================
  // Helpers
  // ============================================================================

  /** Parse a server event from a WebSocket message */
  export function parseServerEvent(data: string): ServerEvent {
    const json = JSON.parse(data)
    return ServerEvent.parse(json)
  }

  /** Serialize a client event for sending over WebSocket */
  export function serializeClientEvent(event: ClientEvent): string {
    return JSON.stringify(ClientEvent.parse(event))
  }
}
