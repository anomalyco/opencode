import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import { upgradeWebSocket } from "hono/bun"
import z from "zod"
import { VoiceService } from "../../voice/service"
import { AudioBuffer } from "../../voice/audio-buffer"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

export const VoiceRoutes = lazy(() =>
  new Hono()
    .get(
      "/status",
      describeRoute({
        summary: "Get voice service status",
        description: "Check if the voice service is available and ready",
        operationId: "voice.status",
        responses: {
          200: {
            description: "Service status",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    available: z.boolean(),
                    config: z.object({
                      enabled: z.boolean(),
                      model: z.string(),
                      device: z.enum(["cuda", "cpu", "auto"]),
                      maxDuration: z.number(),
                      chunkDuration: z.number(),
                    }),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json({
          available: VoiceService.isAvailable(),
          config: VoiceService.getConfig(),
        })
      },
    )
    .post(
      "/transcribe",
      describeRoute({
        summary: "Transcribe audio file",
        description: "Submit a base64-encoded audio file for transcription",
        operationId: "voice.transcribe",
        responses: {
          200: {
            description: "Transcription result",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    text: z.string(),
                    timestamps: z
                      .object({
                        word: z.array(z.object({ start: z.number(), end: z.number(), word: z.string() })),
                        segment: z.array(z.object({ start: z.number(), end: z.number(), segment: z.string() })),
                      })
                      .optional(),
                  }),
                ),
              },
            },
          },
          ...errors(503),
        },
      }),
      validator(
        "json",
        z.object({
          audio: z.string().describe("Base64-encoded WAV audio data"),
          timestamps: z.boolean().optional().default(false),
        }),
      ),
      async (c) => {
        if (!VoiceService.isAvailable()) {
          return c.json({ error: "Transcription service not available" }, 503)
        }

        const { audio, timestamps } = c.req.valid("json")

        try {
          const audioBuffer = Buffer.from(audio, "base64")
          const result = await VoiceService.transcribe(audioBuffer, timestamps)
          return c.json(result)
        } catch (error) {
          console.error("[Transcription] Error:", error)
          return c.json(
            {
              error: error instanceof Error ? error.message : "Transcription failed",
            },
            500,
          )
        }
      },
    )
    .get(
      "/stream",
      describeRoute({
        summary: "Stream audio for transcription",
        description: "Establish a WebSocket connection to stream audio chunks and receive real-time transcriptions",
        operationId: "voice.stream",
        responses: {
          200: {
            description: "WebSocket connection established",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(503),
        },
      }),
      upgradeWebSocket(() => {
        if (!VoiceService.isAvailable()) {
          throw new Error("Transcription service not available")
        }

        const buffer = new AudioBuffer(16000, 1)
        const config = VoiceService.getConfig()
        let isProcessing = false
        let isClosed = false

        return {
          onOpen(_event, ws) {
            ws.send(
              JSON.stringify({
                type: "ready",
                maxDuration: config.maxDuration,
              }),
            )
          },

          async onMessage(event, ws) {
            if (isClosed || isProcessing) return

            try {
              const data = event.data

              // Handle text messages (commands)
              if (typeof data === "string") {
                const msg = JSON.parse(data)

                if (msg.type === "finalize") {
                  // Transcribe whatever we have buffered
                  isProcessing = true

                  if (!buffer.isEmpty()) {
                    try {
                      const wavBuffer = buffer.toWav()
                      const result = await VoiceService.transcribe(wavBuffer, msg.timestamps || false)

                      ws.send(
                        JSON.stringify({
                          type: "transcription",
                          text: result.text,
                          timestamps: result.timestamps,
                          final: true,
                        }),
                      )
                    } catch (error) {
                      ws.send(
                        JSON.stringify({
                          type: "error",
                          message: error instanceof Error ? error.message : "Transcription failed",
                        }),
                      )
                    }

                    buffer.clear()
                  }

                  ws.send(JSON.stringify({ type: "done" }))
                  isProcessing = false
                  return
                }

                if (msg.type === "clear") {
                  buffer.clear()
                  ws.send(JSON.stringify({ type: "cleared" }))
                  return
                }
              }

              // Handle binary audio data
              if (data instanceof ArrayBuffer || Buffer.isBuffer(data)) {
                const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data)
                buffer.append(chunk)

                // Check if we've exceeded max duration
                if (buffer.getDuration() > config.maxDuration) {
                  ws.send(
                    JSON.stringify({
                      type: "error",
                      message: `Maximum recording duration (${config.maxDuration}s) exceeded`,
                    }),
                  )
                  ws.close()
                  return
                }

                // Send progress updates
                ws.send(
                  JSON.stringify({
                    type: "progress",
                    duration: buffer.getDuration(),
                  }),
                )

                // Optional: Perform intermediate transcription every chunkDuration seconds
                if (buffer.getDuration() >= config.chunkDuration && !isProcessing) {
                  isProcessing = true

                  try {
                    const wavBuffer = buffer.toWav()
                    const result = await VoiceService.transcribe(wavBuffer, false)

                    ws.send(
                      JSON.stringify({
                        type: "transcription",
                        text: result.text,
                        final: false,
                      }),
                    )

                    // Keep the buffer for the final transcription
                  } catch (error) {
                    console.error("[Transcription] Intermediate transcription error:", error)
                    // Don't fail the whole session on intermediate errors
                  }

                  isProcessing = false
                }
              }
            } catch (error) {
              console.error("[Transcription] Message handling error:", error)
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: error instanceof Error ? error.message : "Unknown error",
                }),
              )
            }
          },

          onClose() {
            isClosed = true
            buffer.clear()
          },

          onError(_ws, error) {
            console.error("[Transcription] WebSocket error:", error)
          },
        }
      }),
    ),
)
