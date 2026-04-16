import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import type { UpgradeWebSocket } from "hono/ws"
import { Effect } from "effect"
import z from "zod"
import { AppRuntime } from "@/effect/app-runtime"
import { Pty } from "@/pty"
import { PtyID } from "@/pty/schema"
import { NotFoundError } from "../../storage"
import { errors } from "../error"

export function PtyRoutes(upgradeWebSocket: UpgradeWebSocket) {
  return new Hono()
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
        return c.json(
          await AppRuntime.runPromise(
            Effect.gen(function* () {
              const pty = yield* Pty.Service
              return yield* pty.list()
            }),
          ),
        )
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
        const info = await AppRuntime.runPromise(
          Effect.gen(function* () {
            const pty = yield* Pty.Service
            return yield* pty.create(c.req.valid("json"))
          }),
        )
        return c.json(info)
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
      validator("param", z.object({ ptyID: PtyID.zod })),
      async (c) => {
        const info = await AppRuntime.runPromise(
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
                schema: resolver(Pty.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("param", z.object({ ptyID: PtyID.zod })),
      validator("json", Pty.UpdateInput),
      async (c) => {
        const info = await AppRuntime.runPromise(
          Effect.gen(function* () {
            const pty = yield* Pty.Service
            return yield* pty.update(c.req.valid("param").ptyID, c.req.valid("json"))
          }),
        )
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
      validator("param", z.object({ ptyID: PtyID.zod })),
      async (c) => {
        await AppRuntime.runPromise(
          Effect.gen(function* () {
            const pty = yield* Pty.Service
            yield* pty.remove(c.req.valid("param").ptyID)
          }),
        )
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
      validator("param", z.object({ ptyID: PtyID.zod })),
      upgradeWebSocket(async (c) => {
        type Handler = {
          onMessage: (message: string | ArrayBuffer) => void
          onClose: () => void
        }

        const id = PtyID.zod.parse(c.req.param("ptyID"))
        const cursor = (() => {
          const value = c.req.query("cursor")
          if (!value) return
          const parsed = Number(value)
          if (!Number.isSafeInteger(parsed) || parsed < -1) return
          return parsed
        })()
        let handler: Handler | undefined
        if (
          !(await AppRuntime.runPromise(
            Effect.gen(function* () {
              const pty = yield* Pty.Service
              return yield* pty.get(id)
            }),
          ))
        ) {
          throw new Error("Session not found")
        }

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
              }),
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
