import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import { upgradeWebSocket } from "hono/bun"
import z from "zod"
import { Pty } from "@/pty"
import { Storage } from "../../storage/storage"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { getAuthContext } from "../middleware/auth"
import { ServerAuth } from "@/config/server-auth"
import { Log } from "@/util/log"

const log = Log.create({ service: "pty-routes" })

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  return "Unknown error"
}

const mapCreateError = (message: string) => {
  const normalized = message.toLowerCase()
  if (normalized.includes("session not found")) {
    return { code: "broker_session_not_found", status: 404 }
  }
  return { code: "pty_create_failed", status: 500 }
}

export const PtyRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List PTY sessions",
        description: "Get a list of all active pseudo-terminal (PTY) sessions managed by OpenCode.",
        operationId: "pty.list",
        responses: {
          200: {
            description: "List of sessions",
            content: {
              "application/json": {
                schema: resolver(Pty.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(Pty.list())
      },
    )
    .post(
      "/",
      describeRoute({
        summary: "Create PTY session",
        description: "Create a new pseudo-terminal (PTY) session for running shell commands and processes.",
        operationId: "pty.create",
        responses: {
          200: {
            description: "Created session",
            content: {
              "application/json": {
                schema: resolver(Pty.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Pty.CreateInput),
      async (c) => {
        const requestId = crypto.randomUUID()
        const authConfig = ServerAuth.get()

        // If auth enabled, require session and pass session ID
        if (authConfig.enabled) {
          const auth = getAuthContext(c)
          if (!auth) {
            return c.json({ error: "Authentication required" }, 401)
          }
          try {
            const info = await Pty.create(c.req.valid("json"), auth.sessionId, requestId)
            log.info("pty created", { requestId, sessionId: auth.sessionId, ptyId: info.id })
            return c.json(info)
          } catch (error) {
            const message = getErrorMessage(error)
            const mapped = mapCreateError(message)
            log.warn("pty create failed", {
              requestId,
              sessionId: auth.sessionId,
              code: mapped.code,
              error: message,
            })
            return c.json({ error: message, code: mapped.code, requestId }, mapped.status)
          }
        }

        // Auth disabled - use existing behavior
        try {
          const info = await Pty.create(c.req.valid("json"), undefined, requestId)
          log.info("pty created", { requestId, ptyId: info.id })
          return c.json(info)
        } catch (error) {
          const message = getErrorMessage(error)
          const mapped = mapCreateError(message)
          log.warn("pty create failed", { requestId, code: mapped.code, error: message })
          return c.json({ error: message, code: mapped.code, requestId }, mapped.status)
        }
      },
    )
    .get(
      "/:ptyID",
      describeRoute({
        summary: "Get PTY session",
        description: "Retrieve detailed information about a specific pseudo-terminal (PTY) session.",
        operationId: "pty.get",
        responses: {
          200: {
            description: "Session info",
            content: {
              "application/json": {
                schema: resolver(Pty.Info),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ ptyID: z.string() })),
      async (c) => {
        const info = Pty.get(c.req.valid("param").ptyID)
        if (!info) {
          throw new Storage.NotFoundError({ message: "Session not found" })
        }
        return c.json(info)
      },
    )
    .put(
      "/:ptyID",
      describeRoute({
        summary: "Update PTY session",
        description: "Update properties of an existing pseudo-terminal (PTY) session.",
        operationId: "pty.update",
        responses: {
          200: {
            description: "Updated session",
            content: {
              "application/json": {
                schema: resolver(Pty.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("param", z.object({ ptyID: z.string() })),
      validator("json", Pty.UpdateInput),
      async (c) => {
        const authConfig = ServerAuth.get()

        // If auth enabled, require session
        if (authConfig.enabled) {
          const auth = getAuthContext(c)
          if (!auth) {
            return c.json({ error: "Authentication required" }, 401)
          }
        }

        const info = await Pty.update(c.req.valid("param").ptyID, c.req.valid("json"))
        return c.json(info)
      },
    )
    .delete(
      "/:ptyID",
      describeRoute({
        summary: "Remove PTY session",
        description: "Remove and terminate a specific pseudo-terminal (PTY) session.",
        operationId: "pty.remove",
        responses: {
          200: {
            description: "Session removed",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ ptyID: z.string() })),
      async (c) => {
        const authConfig = ServerAuth.get()

        // If auth enabled, require session
        if (authConfig.enabled) {
          const auth = getAuthContext(c)
          if (!auth) {
            return c.json({ error: "Authentication required" }, 401)
          }
          // Note: Future improvement could verify PTY belongs to this user's session
        }

        await Pty.remove(c.req.valid("param").ptyID)
        return c.json(true)
      },
    )
    .get(
      "/:ptyID/connect",
      describeRoute({
        summary: "Connect to PTY session",
        description: "Establish a WebSocket connection to interact with a pseudo-terminal (PTY) session in real-time.",
        operationId: "pty.connect",
        responses: {
          200: {
            description: "Connected session",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ ptyID: z.string() })),
      async (c, next) => {
        const requestId = c.req.query("requestId") ?? crypto.randomUUID()
        const ptyId = c.req.param("ptyID")
        c.set("ptyRequestId", requestId)
        if (!Pty.get(ptyId)) {
          log.warn("pty connect session not found", { requestId, ptyId, code: "pty_session_not_found" })
          return c.json({ error: "Session not found", code: "pty_session_not_found", requestId }, 404)
        }
        return next()
      },
      upgradeWebSocket((c) => {
        const requestId = c.get("ptyRequestId") as string | undefined
        const id = c.req.param("ptyID")
        let handler: ReturnType<typeof Pty.connect>
        return {
          onOpen(_event, ws) {
            log.info("pty websocket opened", { requestId, ptyId: id })
            handler = Pty.connect(id, ws, { requestId })
          },
          onMessage(event) {
            handler?.onMessage(String(event.data))
          },
          onClose() {
            log.info("pty websocket closed", { requestId, ptyId: id })
            handler?.onClose()
          },
        }
      }),
    ),
)
