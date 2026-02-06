import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import { upgradeWebSocket } from "hono/bun"
import z from "zod"
import { Pty } from "@/pty"
import { Storage } from "../../storage/storage"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { ServerAuth } from "@/config/server-auth"
import { Log } from "@/util/log"
import {
  createPtyRequestId,
  createPtyWebSocketHandlers,
  ensurePtyExists,
  ensurePtyConnectSession,
  getPtyErrorMessage,
  getPtyRequestId,
  handlePtyCreateNoAuth,
  handlePtyGet,
  handlePtyRemove,
  handlePtyUpdate,
  mapPtyCreateError,
  maybeHandleAuthPtyCreate,
  maybeRequirePtyAuth,
  resolvePtyConnectRequestId,
  type PtyRouteEnv,
} from "@opencode-ai/fork-terminal/pty-auth-hook"

const log = Log.create({ service: "pty-routes" })

type PtyEnv = PtyRouteEnv

export const PtyRoutes = lazy(() =>
  new Hono<PtyEnv>()
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
        const requestId = createPtyRequestId()
        const authConfig = ServerAuth.get()
        const input = c.req.valid("json")

        const authResponse = await maybeHandleAuthPtyCreate({
          c,
          requestId,
          authEnabled: authConfig.enabled,
          input,
          createPty: (createInput, sessionId, nextRequestId) => Pty.create(createInput, sessionId, nextRequestId),
          mapCreateError: mapPtyCreateError,
          getErrorMessage: getPtyErrorMessage,
          log,
        })

        if (authResponse) {
          return authResponse
        }

        return handlePtyCreateNoAuth({
          c,
          requestId,
          input,
          createPty: (createInput, sessionId, nextRequestId) => Pty.create(createInput, sessionId, nextRequestId),
          mapCreateError: mapPtyCreateError,
          getErrorMessage: getPtyErrorMessage,
          log,
        })
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
        return handlePtyGet({
          c,
          ptyId: c.req.valid("param").ptyID,
          getPty: Pty.get,
          onNotFound: (message) => {
            throw new Storage.NotFoundError({ message })
          },
        })
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
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ ptyID: z.string() })),
      validator("json", Pty.UpdateInput),
      async (c) => {
        const authConfig = ServerAuth.get()
        return handlePtyUpdate({
          c,
          authEnabled: authConfig.enabled,
          ptyId: c.req.valid("param").ptyID,
          input: c.req.valid("json"),
          getPty: Pty.get,
          updatePty: Pty.update,
          onNotFound: (message) => {
            throw new Storage.NotFoundError({ message })
          },
        })
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
        // Note: Future improvement could verify PTY belongs to this user's session
        return handlePtyRemove({
          c,
          authEnabled: authConfig.enabled,
          ptyId: c.req.valid("param").ptyID,
          getPty: Pty.get,
          removePty: Pty.remove,
          onNotFound: (message) => {
            throw new Storage.NotFoundError({ message })
          },
        })
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
        const authConfig = ServerAuth.get()
        const authResponse = maybeRequirePtyAuth(c, authConfig.enabled)
        if (authResponse) return authResponse
        const requestId = resolvePtyConnectRequestId(c)
        const ptyId = c.req.param("ptyID")
        const connectResponse = ensurePtyConnectSession(c, { ptyId, requestId, getPty: Pty.get, log })
        if (connectResponse) return connectResponse
        return next()
      },
      upgradeWebSocket((c) => {
        const requestId = getPtyRequestId(c)
        const id = c.req.param("ptyID")
        return createPtyWebSocketHandlers({ id, requestId, connect: Pty.connect, log })
      }),
    ),
)
