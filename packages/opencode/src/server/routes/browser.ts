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

const Params = z.object({ sessionID: SessionID.zod })
type ID = z.infer<typeof SessionID.zod>
const Enable = z
  .object({
    port: z.number().int().positive().optional(),
  })
  .optional()
const Select = z.object({
  index: z.number().int().nonnegative(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  scale: z.number().positive().optional(),
})
const Viewport = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  scale: z.number().positive().optional(),
})
const Open = z.object({
  url: z.string().min(1),
})
const Action = z.object({
  action: z.enum(["back", "forward", "reload"]),
})
const Tree = z.object({
  sessionID: SessionID.zod,
  tabs: z.array(
    Browser.Tab.extend({
      sessionID: SessionID.zod,
    }),
  ),
})
const param = validator("param", Params)

const size = (body: { width?: number; height?: number; scale?: number }) => ({
  ...(body.width ? { width: body.width } : {}),
  ...(body.height ? { height: body.height } : {}),
  ...(body.scale ? { scale: body.scale } : {}),
})

const socket = (value: unknown): value is Browser.Socket => {
  if (!value || typeof value !== "object") return false
  if (!("readyState" in value) || typeof value.readyState !== "number") return false
  if (!("send" in value) || typeof value.send !== "function") return false
  if (!("close" in value) || typeof value.close !== "function") return false
  return true
}

const send = (ws: Browser.Socket, data: unknown) => {
  if (ws.readyState !== 1) return
  ws.send(JSON.stringify(data))
}

const input = (value: unknown) => {
  if (typeof value === "string" || value instanceof ArrayBuffer) return value
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice().buffer
}

const tree = async (root: ID) => {
  const out = [root]
  await AppRuntime.runPromise(
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      for (const id of out) {
        const kids = yield* sessions.children(id)
        out.push(...kids.map((item) => item.id))
      }
    }),
  )
  return out
}

const tabs = async (root: ID) => {
  const ids = await tree(root)
  const out = await Promise.all(
    ids.map(async (id) => {
      const data = await Browser.tabs(id).catch(() => ({ sessionID: id, tabs: [] }))
      return data.tabs.map((tab) => ({ ...tab, sessionID: id }))
    }),
  )

  return {
    sessionID: root,
    tabs: out.flat(),
  }
}

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
      param,
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
      param,
      validator("json", Enable),
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
      param,
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
      param,
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
                schema: resolver(Tree),
              },
            },
          },
          ...errors(400),
        },
      }),
      param,
      async (c) => {
        const root = c.req.valid("param").sessionID
        return c.json(await tabs(root))
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
      param,
      validator("json", Select),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        return c.json(
          await Browser.select({
            sessionID,
            index: body.index,
            ...size(body),
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
      param,
      validator("json", Viewport),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        return c.json(await Browser.viewport({ sessionID, width: body.width, height: body.height, scale: body.scale }))
      },
    )
    .post(
      "/:sessionID/action",
      describeRoute({
        summary: "Run browser navigation action",
        description: "Run a navigation action on the active browser tab.",
        operationId: "browser.action",
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
      param,
      validator("json", Action),
      async (c) => {
        return c.json(
          await Browser.action({
            sessionID: c.req.valid("param").sessionID,
            action: c.req.valid("json").action,
          }),
        )
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
      param,
      validator("json", Open),
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
      param,
      async (c) => {
        return c.json(await Browser.close(c.req.valid("param").sessionID))
      },
    )
    .get(
      "/:sessionID/tabs/watch",
      describeRoute({
        summary: "Watch browser tabs",
        description: "Keep session browser tab discovery active over a WebSocket connection.",
        operationId: "browser.tabs.watch",
        responses: {
          200: {
            description: "Connected tab watcher",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      param,
      upgradeWebSocket(async (c) => {
        const sessionID = SessionID.zod.parse(c.req.param("sessionID"))
        let handler: Awaited<ReturnType<typeof Browser.observe>> | undefined
        let closed = false

        return {
          async onOpen(_event, ws) {
            const raw = ws.raw
            if (!socket(raw)) {
              closed = true
              ws.close()
              return
            }

            await Browser.observe(sessionID)
              .then((next) => {
                if (closed) {
                  next.onClose()
                  return
                }
                handler = next
                send(raw, { type: "ready" })
              })
              .catch((error: unknown) => {
                send(raw, {
                  type: "error",
                  error: error instanceof Error ? error.message : String(error),
                })
                if (raw.readyState === 1) raw.close(1011, "browser tab watcher startup failed")
              })
          },
          onClose() {
            closed = true
            handler?.onClose()
          },
          onError() {
            closed = true
            handler?.onClose()
          },
        }
      }),
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
      param,
      upgradeWebSocket(async (c) => {
        const sessionID = SessionID.zod.parse(c.req.param("sessionID"))
        let handler: Awaited<ReturnType<typeof Browser.connect>> | undefined

        const pending: (string | ArrayBuffer)[] = []
        let ready = false

        return {
          async onOpen(_event, ws) {
            const raw = ws.raw
            if (!socket(raw)) {
              ws.close()
              return
            }

            await Browser.connect(sessionID, raw)
              .then((next) => {
                handler = next
                ready = true
                send(raw, { type: "ready" })
                for (const item of pending) {
                  next.onMessage(item)
                }
                pending.length = 0
              })
              .catch((error: unknown) => {
                pending.length = 0
                send(raw, {
                  type: "error",
                  error: error instanceof Error ? error.message : String(error),
                })
                if (raw.readyState === 1) raw.close(1011, "browser stream startup failed")
              })
          },
          onMessage(event) {
            const data = input(event.data)
            if (!data) return
            if (!ready || !handler) {
              pending.push(data)
              return
            }
            handler.onMessage(data)
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
