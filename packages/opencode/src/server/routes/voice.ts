import { describeRoute, resolver } from "hono-openapi"
import { zValidator } from "@hono/zod-validator"
import z from "zod"
import { Whisper } from "@/voice/whisper"
import { lazy } from "@/util/lazy"
import { Hono } from "hono"

export const VoiceRoutes = lazy(() =>
  new Hono().post(
    "/transcribe",
    describeRoute({
      summary: "Transcribe audio",
      description: "Transcribe an audio file with Whisper",
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
      const result = await Whisper.transcribe({
        file,
        mime: file.type || "audio/wav",
        sessionID: data.sessionID,
        prompt: data.prompt,
      })
      return c.json(result)
    },
  ),
)
