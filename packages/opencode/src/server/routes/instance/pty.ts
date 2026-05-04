import { Hono } from "hono"
import type { Context } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import type { UpgradeWebSocket } from "hono/ws"
import { Effect, Schema } from "effect"
import z from "zod"
import { AppRuntime } from "@/effect/app-runtime"
import { Pty } from "@/pty"
import { PtyID } from "@/pty/schema"
import { PtyTicket } from "@/pty/ticket"
import { Shell } from "@/shell/shell"
import { NotFoundError } from "@/storage/storage"
import { errors } from "../../error"
import { jsonRequest, runRequest } from "./trace"
import { HTTPException } from "hono/http-exception"
import { isAllowedRequestOrigin, type CorsOptions } from "@/server/cors"
import {
  PTY_CONNECT_TICKET_QUERY,
  PTY_CONNECT_TOKEN_HEADER,
  PTY_CONNECT_TOKEN_HEADER_VALUE,
} from "@/server/shared/pty-ticket"
import { zod as effectZod } from "@/util/effect-zod"

const ShellItem = z.object({
  path: z.string(),
  name: z.string(),
  acceptable: z.boolean(),
})
const decodePtyID = Schema.decodeUnknownSync(PtyID)

function validOrigin(c: Context, opts?: CorsOptions) {
  return isAllowedRequestOrigin(c.req.header("origin"), c.req.header("host"), opts)
}

export function PtyRoutes(upgradeWebSocket: UpgradeWebSocket, opts?: CorsOptions) {
  return new Hono()
    .get(
      "/shells",
      describeRoute({
        summary: "List available shells",
        description: "Get a list of available shells on the system.",
        operationId: "pty.shells",
        responses: {
          200: {
            description: "List of shells",
            content: {
              "application/json": {
                schema: resolver(z.array(ShellItem)),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await Shell.list())
      },
    )
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
                schema: resolver(Pty.Info.zod.array()),
              },
            },
          },
        },
      }),
      async (c) =>
        jsonRequest("PtyRoutes.list", c, function* () {
          const pty = yield* Pty.Service
          return yield* pty.list()
        }),
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
                schema: resolver(Pty.Info.zod),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Pty.CreateInput.zod),
      async (c) =>
        jsonRequest("PtyRoutes.create", c, function* () {
          const pty = yield* Pty.Service
          return yield* pty.create(c.req.valid("json") as Pty.CreateInput)
        }),
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
                schema: resolver(Pty.Info.zod),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ ptyID: PtyID.zod })),
      async (c) => {
        const info = await runRequest(
          "PtyRoutes.get",
          c,
          Effect.gen(function* () {
            const pty = yield* Pty.Service
            return yield* pty.get(c.req.valid("param").ptyID)
          }),
        )
        if (!info) {
          throw new NotFoundError({ message: "Session not found" })
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
                schema: resolver(Pty.Info.zod),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("param", z.object({ ptyID: PtyID.zod })),
      validator("json", Pty.UpdateInput.zod),
      async (c) =>
        jsonRequest("PtyRoutes.update", c, function* () {
          const pty = yield* Pty.Service
          return yield* pty.update(c.req.valid("param").ptyID, c.req.valid("json") as Pty.UpdateInput)
        }),
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
      validator("param", z.object({ ptyID: PtyID.zod })),
      async (c) =>
        jsonRequest("PtyRoutes.remove", c, function* () {
          const pty = yield* Pty.Service
          yield* pty.remove(c.req.valid("param").ptyID)
          return true
        }),
    )
    .post(
      "/:ptyID/connect-token",
      describeRoute({
        summary: "Create PTY WebSocket token",
        description: "Create a short-lived token for opening a PTY WebSocket connection.",
        operationId: "pty.connectToken",
        responses: {
          200: {
            description: "WebSocket connect token",
            content: {
              "application/json": {
                schema: resolver(effectZod(PtyTicket.ConnectToken)),
              },
            },
          },
          ...errors(403, 404),
        },
      }),
      validator("param", z.object({ ptyID: PtyID.zod })),
      async (c) => {
        if (c.req.header(PTY_CONNECT_TOKEN_HEADER) !== PTY_CONNECT_TOKEN_HEADER_VALUE || !validOrigin(c, opts))
          throw new HTTPException(403)
        const result = await runRequest(
          "PtyRoutes.connectToken",
          c,
          Effect.gen(function* () {
            const pty = yield* Pty.Service
            const id = c.req.valid("param").ptyID
            if (!(yield* pty.get(id))) return
            const tickets = yield* PtyTicket.Service
            return yield* tickets.issue({ ptyID: id, ...(yield* PtyTicket.scope) })
          }),
        )
        if (!result) throw new NotFoundError({ message: "Session not found" })
        return c.json(result)
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
          ...errors(403, 404),
        },
      }),
      validator("param", z.object({ ptyID: PtyID.zod })),
      upgradeWebSocket(async (c) => {
        type Handler = {
          onMessage: (message: string | ArrayBuffer) => void
          onClose: () => void
        }

        const id = decodePtyID(c.req.param("ptyID"))
        if (
          !(await runRequest(
            "PtyRoutes.connect",
            c,
            Effect.gen(function* () {
              const pty = yield* Pty.Service
              return yield* pty.get(id)
            }),
          ))
        ) {
          throw new NotFoundError({ message: "Session not found" })
        }
        const ticket = c.req.query(PTY_CONNECT_TICKET_QUERY)
        if (ticket) {
          if (!validOrigin(c, opts)) throw new HTTPException(403)
          const valid = await runRequest(
            "PtyRoutes.connect.ticket",
            c,
            Effect.gen(function* () {
              const tickets = yield* PtyTicket.Service
              return yield* tickets.consume({ ticket, ptyID: id, ...(yield* PtyTicket.scope) })
            }),
          )
          if (!valid) throw new HTTPException(403)
        }
        const cursor = (() => {
          const value = c.req.query("cursor")
          if (!value) return
          const parsed = Number(value)
          if (!Number.isSafeInteger(parsed) || parsed < -1) return
          return parsed
        })()
        let handler: Handler | undefined

        type Socket = {
          readyState: number
          send: (data: string | Uint8Array | ArrayBuffer) => void
          close: (code?: number, reason?: string) => void
        }

        const isSocket = (value: unknown): value is Socket => {
          if (!value || typeof value !== "object") return false
          if (!("readyState" in value)) return false
          if (!("send" in value) || typeof (value as { send?: unknown }).send !== "function") return false
          if (!("close" in value) || typeof (value as { close?: unknown }).close !== "function") return false
          return typeof (value as { readyState?: unknown }).readyState === "number"
        }

        const pending: string[] = []
        let ready = false

        return {
          async onOpen(_event, ws) {
            const socket = ws.raw
            if (!isSocket(socket)) {
              ws.close()
              return
            }
            handler = await AppRuntime.runPromise(
              Effect.gen(function* () {
                const pty = yield* Pty.Service
                return yield* pty.connect(id, socket, cursor)
              }).pipe(Effect.withSpan("PtyRoutes.connect.open")),
            )
            ready = true
            for (const msg of pending) handler?.onMessage(msg)
            pending.length = 0
          },
          onMessage(event) {
            if (typeof event.data !== "string") return
            if (!ready) {
              pending.push(event.data)
              return
            }
            handler?.onMessage(event.data)
          },
          onClose() {
            handler?.onClose()
          },
          onError() {
            handler?.onClose()
          },
        }
      }),
    )
}
