import { describeRoute, resolver } from "hono-openapi"
import { zValidator } from "@hono/zod-validator"
import z from "zod"
import { Config } from "@/config/config"
import { AppRuntime } from "@/effect/app-runtime"
import { Alm } from "@/voice/alm"
import { Whisper } from "@/voice/whisper"
import { resolveType } from "@/voice/common"
import { lazy } from "@/util/lazy"
import { Hono } from "hono"
import type { SessionID } from "@/session/schema"

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
        file: z.instanceof(File).refine((f) => f.size <= 25 * 1024 * 1024, "File too large (max 25MB)"),
        sessionID: z.string().optional(),
        prompt: z.string().optional(),
      }),
    ),
    // Server-level basic auth is inherited from parent Hono instance.
    // Voice route forwards API keys to third-party transcription providers (Whisper/ALM).
    // Rate limiting recommended for production deployments.
    async (c) => {
      const data = c.req.valid("form")
      const file = data.file
      const mime = file.type || "audio/wav"
      const cfg = await AppRuntime.runPromise(Config.Service.use((svc) => svc.get()))
      const voice = cfg.voice
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
            sessionID: data.sessionID as SessionID | undefined,
            prompt: data.prompt,
            voice,
          }))
      return c.json(result)
    },
  ),
)
