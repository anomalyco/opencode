import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import { upgradeWebSocket } from "hono/bun"
import z from "zod"
import { Browser } from "@/browser"
import { SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { AppRuntime } from "@/effect/app-runtime"
import { Effect } from "effect"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

export const BrowserRoutes = lazy(() =>
  new Hono()
    .get(
      "/:sessionID/status",
      describeRoute({
        summary: "Get browser stream status",
        description: "Get agent-browser runtime status for a session.",
        operationId: "browser.status",
        responses: {
          200: {
            description: "Browser runtime status",
            content: {
              "application/json": {
                schema: resolver(Browser.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      async (c) => {
        return c.json(await Browser.status(c.req.valid("param").sessionID))
      },
    )
    .post(
      "/:sessionID/stream/enable",
      describeRoute({
        summary: "Enable browser stream",
        description: "Enable agent-browser WebSocket stream for a session.",
        operationId: "browser.stream.enable",
        responses: {
          200: {
            description: "Browser runtime status",
            content: {
              "application/json": {
                schema: resolver(Browser.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      validator(
        "json",
        z
          .object({
            port: z.number().int().positive().optional(),
          })
          .optional(),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        return c.json(await Browser.enable({ sessionID, ...(body?.port ? { port: body.port } : {}) }))
      },
    )
    .post(
      "/:sessionID/stream/disable",
      describeRoute({
        summary: "Disable browser stream",
        description: "Disable agent-browser WebSocket stream for a session.",
        operationId: "browser.stream.disable",
        responses: {
          200: {
            description: "Browser runtime status",
            content: {
              "application/json": {
                schema: resolver(Browser.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      async (c) => {
        return c.json(await Browser.disable(c.req.valid("param").sessionID))
      },
    )
    .get(
      "/:sessionID/tabs",
      describeRoute({
        summary: "List browser tabs",
        description: "List session-isolated browser tabs.",
        operationId: "browser.tabs",
        responses: {
          200: {
            description: "Browser tabs",
            content: {
              "application/json": {
                schema: resolver(Browser.Tabs),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      async (c) => {
        return c.json(await Browser.tabs(c.req.valid("param").sessionID))
      },
    )
    .get(
      "/:sessionID/tabs/all",
      describeRoute({
        summary: "List browser tabs across session tree",
        description: "List browser tabs for a session and all descendant sessions.",
        operationId: "browser.tabs.all",
        responses: {
          200: {
            description: "Browser tabs",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    sessionID: SessionID.zod,
                    tabs: z.array(
                      Browser.Tab.extend({
                        sessionID: SessionID.zod,
                      }),
                    ),
                  }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      async (c) => {
        const root = c.req.valid("param").sessionID
        const seen = new Set<string>([root])
        const all = [root]
        const stack = [root]

        await AppRuntime.runPromise(
          Effect.gen(function* () {
            const sessions = yield* Session.Service
            while (stack.length > 0) {
              const id = stack.shift()
              if (!id) continue
              const kids = yield* sessions.children(id)
              for (const kid of kids) {
                if (seen.has(kid.id)) continue
                seen.add(kid.id)
                all.push(kid.id)
                stack.push(kid.id)
              }
            }
          }),
        )
          }
        }

        const out = await Promise.all(
          all.map(async (id) => {
            const data = await Browser.tabs(id).catch(() => ({ sessionID: id, tabs: [] }))
            return data.tabs.map((tab) => ({ ...tab, sessionID: id }))
          }),
        )

        return c.json({
          sessionID: root,
          tabs: out.flat(),
        })
      },
    )
    .post(
      "/:sessionID/tab/select",
      describeRoute({
        summary: "Select browser tab",
        description: "Select active browser tab in a session.",
        operationId: "browser.tab.select",
        responses: {
          200: {
            description: "Browser tabs",
            content: {
              "application/json": {
                schema: resolver(Browser.Tabs),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      validator(
        "json",
        z.object({
          index: z.number().int().nonnegative(),
          width: z.number().int().positive().optional(),
          height: z.number().int().positive().optional(),
          scale: z.number().positive().optional(),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        return c.json(
          await Browser.select({
            sessionID,
            index: body.index,
            ...(body.width ? { width: body.width } : {}),
            ...(body.height ? { height: body.height } : {}),
            ...(body.scale ? { scale: body.scale } : {}),
          }),
        )
      },
    )
    .post(
      "/:sessionID/viewport",
      describeRoute({
        summary: "Set browser viewport",
        description: "Set session browser viewport size.",
        operationId: "browser.viewport",
        responses: {
          200: {
            description: "Browser runtime status",
            content: {
              "application/json": {
                schema: resolver(Browser.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      validator(
        "json",
        z.object({
          width: z.number().int().positive(),
          height: z.number().int().positive(),
          scale: z.number().positive().optional(),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        return c.json(await Browser.viewport({ sessionID, width: body.width, height: body.height, scale: body.scale }))
      },
    )
    .post(
      "/:sessionID/open",
      describeRoute({
        summary: "Open browser URL",
        description: "Open a URL in the session-isolated agent-browser runtime.",
        operationId: "browser.open",
        responses: {
          200: {
            description: "Browser runtime status",
            content: {
              "application/json": {
                schema: resolver(Browser.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      validator(
        "json",
        z.object({
          url: z.string().min(1),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        return c.json(await Browser.open({ sessionID, url: body.url }))
      },
    )
    .post(
      "/:sessionID/close",
      describeRoute({
        summary: "Close browser session",
        description: "Close the session-isolated browser runtime.",
        operationId: "browser.close",
        responses: {
          200: {
            description: "Browser runtime status",
            content: {
              "application/json": {
                schema: resolver(Browser.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      async (c) => {
        return c.json(await Browser.close(c.req.valid("param").sessionID))
      },
    )
    .get(
      "/:sessionID/stream/connect",
      describeRoute({
        summary: "Connect to browser stream",
        description: "Proxy agent-browser stream frames over a WebSocket connection.",
        operationId: "browser.stream.connect",
        responses: {
          200: {
            description: "Connected stream",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      upgradeWebSocket(async (c) => {
        const sessionID = SessionID.zod.parse(c.req.param("sessionID"))
        let handler: Awaited<ReturnType<typeof Browser.connect>> | undefined

        type Socket = {
          readyState: number
          send: (data: string | Uint8Array | ArrayBuffer) => void
          close: (code?: number, reason?: string) => void
        }

        const isSocket = (value: unknown): value is Socket => {
          if (!value || typeof value !== "object") return false
          if (!("readyState" in value) || typeof (value as { readyState?: unknown }).readyState !== "number")
            return false
          if (!("send" in value) || typeof (value as { send?: unknown }).send !== "function") return false
          if (!("close" in value) || typeof (value as { close?: unknown }).close !== "function") return false
          return true
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

            handler = await Browser.connect(sessionID, socket)
            ready = true
            for (const item of pending) {
              handler.onMessage(item)
            }
            pending.length = 0
          },
          onMessage(event) {
            if (typeof event.data !== "string") return
            if (!ready || !handler) {
              pending.push(event.data)
              return
            }
            handler.onMessage(event.data)
          },
          onClose() {
            handler?.onClose()
          },
          onError() {
            handler?.onClose()
          },
        }
      }),
    ),
)
