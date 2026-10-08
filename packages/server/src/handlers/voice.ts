import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { InvalidRequestError, ServiceUnavailableError } from "@opencode/protocol/errors"
import { VoiceEvent } from "@opencode/schema/voice-event"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"

// OpenAI-compatible transcription endpoints require a model name; local speech
// servers ignore it. Kept as a wire fallback so voice ships with no model set.
const fallbackModel = "whisper-1"

export const VoiceHandler = HttpApiBuilder.group(Api, "server.voice", (handlers) =>
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    return handlers
      .handle(
        "voice.transcribe",
        Effect.fn("server.voice.transcribe")(function* (request) {
          const config = yield* Config.Service
          const voice = Config.latest(yield* config.entries(), "voice")
          const url = voice?.url?.trim()
          if (!url) {
            return yield* new InvalidRequestError({
              message: "Voice transcription is not configured",
              kind: "voice_not_configured",
              field: "voice.url",
            })
          }

          const mime = request.payload.mime || "audio/webm"
          const extension = mime.includes("wav")
            ? "wav"
            : mime.includes("mpeg") || mime.includes("mp3")
              ? "mp3"
              : mime.includes("ogg")
                ? "ogg"
                : mime.includes("mp4") || mime.includes("m4a")
                  ? "m4a"
                  : "webm"
          const form = new FormData()
          form.append(
            "file",
            new Blob([Buffer.from(request.payload.audio, "base64")], { type: mime }),
            `audio.${extension}`,
          )
          form.append("model", voice?.model?.trim() || fallbackModel)
          form.append("response_format", "json")
          const prompt = request.payload.prompt?.trim()
          if (prompt) form.append("prompt", prompt)
          const apiKey = voice?.apiKey?.trim()

          const response = yield* Effect.tryPromise({
            try: (signal) =>
              fetch(url, {
                method: "POST",
                headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
                body: form,
                signal,
              }),
            catch: () =>
              new ServiceUnavailableError({
                message: "Voice transcription request failed",
                service: "voice",
              }),
          })

          if (!response.ok) {
            const detail = yield* Effect.promise(() => response.text().catch(() => ""))
            return yield* new ServiceUnavailableError({
              message: detail.trim().slice(0, 500) || `Voice transcription failed (${response.status})`,
              service: "voice",
            })
          }

          const body = yield* Effect.tryPromise({
            try: () => response.json() as Promise<{ text?: unknown }>,
            catch: () =>
              new ServiceUnavailableError({
                message: "Voice transcription returned an invalid response",
                service: "voice",
              }),
          })

          return { text: typeof body.text === "string" ? body.text : "" }
        }),
      )
      .handle(
        "voice.recording",
        Effect.fn("server.voice.recording")(function* () {
          yield* bus.publish(VoiceEvent.Recording, {})
          return HttpApiSchema.NoContent.make()
        }),
      )
  }),
)
