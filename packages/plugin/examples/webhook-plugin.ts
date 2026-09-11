/**
 * Example plugin: inbound webhook that starts an agent run.
 *
 * Register it in opencode.json:
 *
 *   {
 *     "plugin": [
 *       [
 *         "file:///path/to/webhook-plugin.ts",
 *         { "agent": "build", "secret": "s3cret" }
 *       ]
 *     ]
 *   }
 *
 * Then POST to the opencode server:
 *
 *   curl -X POST http://localhost:4096/plugin/webhook-plugin/webhook \
 *     -H 'content-type: application/json' \
 *     -H 'x-webhook-secret: s3cret' \
 *     -d '{"text": "fix the failing tests"}'
 *
 * The message is handed to the configured agent on a fresh session (or on
 * an existing one when the request body carries a `sessionID`) and the
 * server responds 202 immediately; the agent keeps running in the
 * background.
 */
import type { Plugin } from "@opencode-ai/plugin"

type WebhookOptions = {
  /** Agent used for new sessions (default: "build") */
  agent?: string
  /** Shared secret required in the `x-webhook-secret` header */
  secret?: string
}

export const WebhookPlugin: Plugin = async (input, options) => {
  const agent = typeof options?.agent === "string" ? options.agent : "build"
  const secret = typeof options?.secret === "string" ? options.secret : undefined

  return {
    routes: [
      {
        method: "POST",
        path: "/webhook",
        async handler(request) {
          if (secret && request.headers["x-webhook-secret"] !== secret) {
            return { status: 401, body: { error: "Invalid webhook secret" } }
          }

          const body = isRecord(request.body) ? (request.body as { text?: unknown; sessionID?: unknown; agent?: unknown }) : {}
          const text = typeof body.text === "string" ? body.text : ""
          if (!text) return { status: 400, body: { error: "Body must be JSON with a non-empty `text` field" } }

          const runAgent = typeof body.agent === "string" ? body.agent : agent
          let sessionID = typeof body.sessionID === "string" ? body.sessionID : ""
          if (!sessionID) {
            const created = await input.client.session.create({ agent: runAgent })
            sessionID = created.data?.id
            if (!sessionID) return { status: 500, body: { error: "Failed to create session" } }
          }

          await input.client.session.promptAsync({
            path: { id: sessionID },
            body: {
              agent: runAgent,
              parts: [{ type: "text" as const, text }],
            },
          })

          return { status: 202, body: { sessionID, agent: runAgent } }
        },
      },
    ],
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export default {
  id: "webhook-plugin",
  server: WebhookPlugin,
}
