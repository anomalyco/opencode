import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import { upgradeWebSocket } from "hono/bun"
import z from "zod"
import { VoiceService, Voice } from "../../voice/service"
import { AudioBuffer } from "../../voice/audio-buffer"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

export const VoiceRoutes = lazy(() =>
  new Hono()
    .get(
      "/status",
      describeRoute({
        summary: "Get voice service status",
        description: "Check the current status of the voice transcription service",
        operationId: "voice.status",
        responses: {
          200: {
            description: "Service status",
            content: {
              "application/json": {
                schema: resolver(Voice.Status),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(VoiceService.getStatus())
      },
    )
    .post(
      "/enable",
      describeRoute({
        summary: "Enable voice transcription",
        description: "Enable voice transcription with optional model selection",
        operationId: "voice.enable",
        responses: {
          200: {
            description: "Enable result",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    success: z.boolean(),
                  }),
                ),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          model: z.enum(["tiny", "base", "small"]).optional(),
        }),
      ),
      async (c) => {
        const { model } = c.req.valid("json")
        const success = await VoiceService.enable(model)
        return c.json({ success })
      },
    )
    .post(
      "/disable",
      describeRoute({
        summary: "Disable voice transcription",
        description: "Disable voice transcription service",
        operationId: "voice.disable",
        responses: {
          200: {
            description: "Disabled successfully",
            content: {
              "application/json": {
                schema: resolver(z.object({ success: z.boolean() })),
              },
            },
          },
        },
      }),
      async (c) => {
        await VoiceService.disable()
        return c.json({ success: true })
      },
    )
    .get(
      "/models",
      describeRoute({
        summary: "List available models",
        description: "Get list of available Whisper models",
        operationId: "voice.models",
        responses: {
          200: {
            description: "Available models",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    available: z.array(
                      z.object({
                        name: z.enum(["tiny", "base", "small"]),
                        size: z.string(),
                      }),
                    ),
                    downloaded: z.array(z.enum(["tiny", "base", "small"])),
                    current: z.enum(["tiny", "base", "small"]),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const available = await VoiceService.getAvailableModels()
        const downloaded = await VoiceService.getDownloadedModels()
        const current = VoiceService.getCurrentModel()
        return c.json({ available, downloaded, current })
      },
    )
    .post(
      "/switch-model",
      describeRoute({
        summary: "Switch to a different model",
        description: "Switch the voice transcription model",
        operationId: "voice.switchModel",
        responses: {
          200: {
            description: "Model switch result",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    success: z.boolean(),
                  }),
                ),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          model: z.enum(["tiny", "base", "small"]),
        }),
      ),
      async (c) => {
        const { model } = c.req.valid("json")
        const success = await VoiceService.switchModel(model)
        return c.json({ success })
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
                    chunks: z
                      .array(
                        z.object({
                          text: z.string(),
                          timestamp: z.tuple([z.number(), z.number()]),
                        }),
                      )
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
        if (!VoiceService.isReady()) {
          return c.json({ error: "Transcription service not ready" }, 503)
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
        if (!VoiceService.isReady()) {
          throw new Error("Transcription service not ready")
        }

        const buffer = new AudioBuffer(16000, 1)
        const maxDuration = 300
        const chunkDuration = 3
        let isProcessing = false
        let isClosed = false

        return {
          onOpen(_event, ws) {
            ws.send(
              JSON.stringify({
                type: "ready",
                maxDuration,
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
                          chunks: result.chunks,
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
                if (buffer.getDuration() > maxDuration) {
                  ws.send(
                    JSON.stringify({
                      type: "error",
                      message: `Maximum recording duration (${maxDuration}s) exceeded`,
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
                if (buffer.getDuration() >= chunkDuration && !isProcessing) {
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
