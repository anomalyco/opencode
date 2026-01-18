import { describeRoute, resolver } from "hono-openapi"
import { zValidator } from "@hono/zod-validator"
import z from "zod"
import { Config } from "@/config/config"
import { Alm } from "@/voice/alm"
import { Whisper } from "@/voice/whisper"
import { lazy } from "@/util/lazy"
import { Hono } from "hono"

const resolveType = (voice?: Config.Info["voice"]) => {
  if (voice?.type) return voice.type
  if (voice?.whisper?.apiKey && !voice?.alm?.apiKey) return "whisper"
  if (voice?.alm?.apiKey && !voice?.whisper?.apiKey) return "alm"
  if (voice?.whisper?.apiKey) return "whisper"
  if (voice?.alm?.apiKey) return "alm"
  return "whisper"
}

export const VoiceRoutes = lazy(() =>
  new Hono().post(
    "/transcribe",
    describeRoute({
      summary: "Transcribe audio",
      description: "Transcribe an audio file with Whisper or an audio language model",
      operationId: "audio.transcribe",
      responses: {
        200: {
          description: "Transcription result",
          content: {
            "application/json": {
              schema: resolver(Whisper.Response),
            },
          },
        },
      },
    }),
    zValidator(
      "form",
      z.object({
        file: z.instanceof(File),
        sessionID: z.string().optional(),
        prompt: z.string().optional(),
      }),
    ),
    async (c) => {
      const data = c.req.valid("form")
      const file = data.file
      const mime = file.type || "audio/wav"
      const voice = (await Config.get()).voice
      const type = resolveType(voice)
      const result = await (type === "alm"
        ? Alm.transcribe({
            file,
            mime,
            sessionID: data.sessionID,
            prompt: data.prompt,
            voice,
          })
        : Whisper.transcribe({
            file,
            mime,
            sessionID: data.sessionID,
            prompt: data.prompt,
            voice,
          }))
      return c.json(result)
    },
  ),
)
