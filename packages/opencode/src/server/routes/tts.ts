import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { zValidator } from "@hono/zod-validator"
import z from "zod"
import { TTS } from "@/tts"
import { logTTSEvent } from "@/tts/telemetry"
import { lazy } from "@/util/lazy"

export const TTSRoutes = lazy(() =>
  new Hono()
    .post(
      "/speak",
      describeRoute({
        summary: "Synthesize speech",
        description: "Convert text to speech audio using Edge TTS",
        operationId: "tts.speak",
        responses: {
          200: {
            description: "MP3 audio stream",
            content: { "audio/mpeg": {} },
          },
        },
      }),
      zValidator(
        "json",
        z.object({
          text: z.string(),
          voice: z.string().optional(),
          rate: z.string().optional(),
          volume: z.string().optional(),
          pitch: z.string().optional(),
        }),
      ),
      async (c) => {
        const input = c.req.valid("json")
        const stream = await TTS.synthesize(input)
        return new Response(stream, {
          headers: { "content-type": "audio/mpeg" },
        })
      },
    )
    .get(
      "/voices",
      describeRoute({
        summary: "List TTS voices",
        operationId: "tts.voices",
        responses: {
          200: {
            description: "Available voices",
            content: {
              "application/json": {
                schema: resolver(z.array(z.string())),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(TTS.getVoices())
      },
    )
    .post(
      "/telemetry",
      zValidator(
        "json",
        z.object({
          timestamp: z.string(),
          event: z.string(),
          sessionID: z.string(),
          messageID: z.string(),
          partID: z.string().optional(),
          reason: z.string().optional(),
          duration: z.number().optional(),
          queueLength: z.number().optional(),
          error: z.string().optional(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        logTTSEvent(body)
        return c.json(true)
      },
    ),
)
