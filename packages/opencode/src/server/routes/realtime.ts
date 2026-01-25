import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import { upgradeWebSocket } from "hono/bun"
import z from "zod"
import { Session } from "../../session"
import { RealtimeSession } from "../../realtime/session"
import { RealtimeProtocol } from "../../realtime/protocol"
import { Storage } from "../../storage/storage"
import { Config } from "../../config/config"
import { Provider } from "../../provider/provider"
import { errors } from "../error"
import { NamedError } from "@opencode-ai/util/error"
import { lazy } from "../../util/lazy"
import { Log } from "../../util/log"

const log = Log.create({ service: "server.realtime" })

const RealtimeStatus = z
  .object({
    active: z.boolean(),
    state: z.enum(["idle", "connecting", "connected", "disconnected", "error"]).optional(),
    sessionID: z.string(),
  })
  .meta({ ref: "RealtimeStatus" })

const StartInput = z
  .object({
    apiKey: z.string().optional().describe("OpenAI API key (uses configured provider key if not provided)"),
    model: z.string().optional().describe("OpenAI model to use (default: gpt-4o-realtime-preview)"),
  })
  .meta({ ref: "RealtimeStartInput" })

const RealtimeConfigError = NamedError.create(
  "RealtimeConfigError",
  z.object({ message: z.string() }),
)

export const RealtimeRoutes = lazy(() =>
  new Hono()
    // Get realtime session status
    .get(
      "/:sessionID/status",
      describeRoute({
        summary: "Get realtime session status",
        description: "Check if a realtime session is active and get its current state.",
        operationId: "realtime.status",
        responses: {
          200: {
            description: "Realtime session status",
            content: {
              "application/json": {
                schema: resolver(RealtimeStatus),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ sessionID: Session.get.schema })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID

        // Verify base session exists
        const session = await Session.get(sessionID)
        if (!session) {
          throw new Storage.NotFoundError({ message: "Session not found" })
        }

        const realtimeSession = RealtimeSession.get(sessionID)
        return c.json({
          active: !!realtimeSession,
          state: realtimeSession?.state,
          sessionID,
        })
      },
    )

    // Start a realtime session
    .post(
      "/:sessionID/start",
      describeRoute({
        summary: "Start realtime session",
        description: "Initialize a realtime connection to OpenAI for the given session.",
        operationId: "realtime.start",
        responses: {
          200: {
            description: "Realtime session started",
            content: {
              "application/json": {
                schema: resolver(RealtimeStatus),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: Session.get.schema })),
      validator("json", StartInput),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const input = c.req.valid("json")

        // Verify base session exists
        const session = await Session.get(sessionID)
        if (!session) {
          throw new Storage.NotFoundError({ message: "Session not found" })
        }

        // Check if already active
        let realtimeSession = RealtimeSession.get(sessionID)
        if (realtimeSession && realtimeSession.state === "connected") {
          return c.json({
            active: true,
            state: realtimeSession.state,
            sessionID,
          })
        }

        // Get config and resolve API key
        const config = await Config.get()
        const realtimeConfig = config.experimental?.realtime

        // Get API key: request param > provider key
        let apiKey = input.apiKey
        if (!apiKey) {
          const openaiProvider = await Provider.getProvider("openai")
          apiKey = openaiProvider?.key
        }

        if (!apiKey) {
          throw new RealtimeConfigError({
            message: "No OpenAI API key configured. Set OPENAI_API_KEY or provide apiKey in request.",
          })
        }

        // Get model: request param > config > default
        const model = input.model ?? realtimeConfig?.model ?? "gpt-4o-realtime-preview"

        // Build session config from experimental.realtime settings
        const sessionConfig: Partial<RealtimeProtocol.SessionConfig> = {}
        if (realtimeConfig) {
          if (realtimeConfig.voice) sessionConfig.voice = realtimeConfig.voice
          if (realtimeConfig.input_audio_format) sessionConfig.input_audio_format = realtimeConfig.input_audio_format
          if (realtimeConfig.output_audio_format) sessionConfig.output_audio_format = realtimeConfig.output_audio_format

          // Turn detection
          if (realtimeConfig.turn_detection === "none") {
            sessionConfig.turn_detection = null
          } else if (realtimeConfig.turn_detection === "server_vad" || realtimeConfig.vad) {
            sessionConfig.turn_detection = {
              type: "server_vad",
              ...(realtimeConfig.vad?.threshold !== undefined && { threshold: realtimeConfig.vad.threshold }),
              ...(realtimeConfig.vad?.prefix_padding_ms !== undefined && {
                prefix_padding_ms: realtimeConfig.vad.prefix_padding_ms,
              }),
              ...(realtimeConfig.vad?.silence_duration_ms !== undefined && {
                silence_duration_ms: realtimeConfig.vad.silence_duration_ms,
              }),
            }
          }
        }

        // Create and start new realtime session
        log.info("starting realtime session", { sessionID, model })
        realtimeSession = RealtimeSession.create({
          sessionID,
          apiKey,
          model,
          sessionConfig,
        })

        try {
          await realtimeSession.start()
        } catch (error) {
          log.error("failed to start realtime session", { sessionID, error })
          throw error
        }

        return c.json({
          active: true,
          state: realtimeSession.state,
          sessionID,
        })
      },
    )

    // Stop a realtime session
    .delete(
      "/:sessionID/stop",
      describeRoute({
        summary: "Stop realtime session",
        description: "Disconnect and clean up the realtime session.",
        operationId: "realtime.stop",
        responses: {
          200: {
            description: "Realtime session stopped",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ sessionID: Session.get.schema })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID

        const realtimeSession = RealtimeSession.get(sessionID)
        if (!realtimeSession) {
          throw new Storage.NotFoundError({ message: "Realtime session not found" })
        }

        log.info("stopping realtime session", { sessionID })
        realtimeSession.stop()

        return c.json(true)
      },
    )

    // WebSocket endpoint for realtime audio streaming
    .get(
      "/:sessionID/connect",
      describeRoute({
        summary: "Connect to realtime session",
        description:
          "Establish a WebSocket connection for bidirectional audio streaming with the OpenAI Realtime API.",
        operationId: "realtime.connect",
        responses: {
          200: {
            description: "WebSocket connection established",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ sessionID: Session.get.schema })),
      upgradeWebSocket((c) => {
        const sessionID = c.req.param("sessionID")
        const realtimeSession = RealtimeSession.get(sessionID)

        if (!realtimeSession) {
          throw new Error("Realtime session not found - call /start first")
        }

        log.info("client WebSocket connecting", { sessionID })

        return {
          onOpen(_event, ws) {
            log.info("client WebSocket connected", { sessionID })

            // Forward messages from OpenAI to client
            realtimeSession.on({
              onClientMessage: (message) => {
                try {
                  ws.send(message)
                } catch (error) {
                  log.error("failed to send to client", { sessionID, error })
                }
              },
              onError: (error) => {
                log.error("realtime session error", { sessionID, error: error.message })
                ws.close(1011, error.message)
              },
            })
          },

          onMessage(event) {
            // Route client messages to OpenAI
            realtimeSession.handleClientMessage(String(event.data))
          },

          onClose() {
            log.info("client WebSocket disconnected", { sessionID })
            // Don't stop the realtime session - allow reconnection
          },
        }
      }),
    ),
)
