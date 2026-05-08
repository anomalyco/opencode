import { Hono } from "hono"
import { describeRoute, validator } from "hono-openapi"
import z from "zod"
import { lazy } from "@/util/lazy"
import { synth } from "@/tts/edge"
import { errors } from "../error"

export const TtsRoutes = lazy(() =>
  new Hono().post(
    "/edge",
    describeRoute({
      summary: "Convert text to speech with Edge TTS",
      description: "Generate MP3 audio using the server-backed Edge TTS engine.",
      operationId: "tts.edge",
      responses: {
        200: {
          description: "MP3 audio",
          content: {
            "audio/mpeg": {
              schema: { type: "string", format: "binary" },
            },
          },
        },
        ...errors(400),
      },
    }),
    validator(
      "json",
      z.object({
        text: z.string().min(1).max(4096),
      }),
    ),
    async (c) => {
      const body = c.req.valid("json")
      const audio = await synth(body.text.trim())
      return new Response(audio, {
        headers: {
          "Content-Type": "audio/mpeg",
          "Cache-Control": "no-store",
        },
      })
    },
  ),
)
