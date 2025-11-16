import { Log } from "../util/log"
import { Bus } from "../bus"
import { generateSpecs, openAPIRouteHandler, validator } from "hono-openapi"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { proxy } from "hono/proxy"
import z from "zod"
import { NamedError } from "../util/error"
import { Instance } from "../project/instance"
import { InstanceBootstrap } from "../project/bootstrap"
import { lazy } from "../util/lazy"
import { Storage } from "../storage/storage"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { Provider } from "../provider/provider"
import { ProjectRoute } from "./project"
import { TuiRoute } from "./tui"

import {
  sessionRoutes,
  configRoutes,
  favoriteToolsRoutes,
  providerRoutes,
  fileRoutes,
  findRoutes,
  toolRoutes,
  mcpRoutes,
  tuiRoutes,
  uiRoutes,
  eventRoutes,
  globalEventRoutes,
  agentRoutes,
  authRoutes,
  lspRoutes,
  formatterRoutes,
  pluginRoutes,
  commandRoutes,
  pathRoutes,
  logRoutes,
} from "./routes"

export namespace Server {
  const log = Log.create({ service: "server" })

  export const Event = {
    Connected: Bus.event("server.connected", z.object({})),
  }

  const app = new Hono()
  export const App = lazy(() =>
    app
      .onError((err, c) => {
        log.error("failed", {
          error: err,
        })
        if (err instanceof NamedError) {
          let status: ContentfulStatusCode
          if (err instanceof Storage.NotFoundError) status = 404
          else if (err instanceof Provider.ModelNotFoundError) status = 400
          else status = 500
          return c.json(err.toObject(), { status })
        }
        const message = err instanceof Error && err.stack ? err.stack : err.toString()
        return c.json(new NamedError.Unknown({ message }).toObject(), {
          status: 500,
        })
      })
      .use(async (c, next) => {
        const skipLogging = c.req.path === "/log"
        if (!skipLogging) {
          log.info("request", {
            method: c.req.method,
            path: c.req.path,
          })
        }
        const timer = log.time("request", {
          method: c.req.method,
          path: c.req.path,
        })
        await next()
        if (!skipLogging) {
          timer.stop()
        }
      })
      .route("/global/event", globalEventRoutes())
      .use(async (c, next) => {
        const directory = c.req.query("directory") ?? process.cwd()
        return Instance.provide({
          directory,
          init: InstanceBootstrap,
          async fn() {
            return next()
          },
        })
      })
      .use(cors())
      .get(
        "/doc",
        openAPIRouteHandler(app, {
          documentation: {
            info: {
              title: "opencode",
              version: "0.0.3",
              description: "opencode api",
            },
            openapi: "3.1.1",
          },
        }),
      )
      .use(validator("query", z.object({ directory: z.string().optional() })))
      .route("/project", ProjectRoute)
      .route("/config", configRoutes())
      .route("/config", providerRoutes())
      .route("/favorite-tools", favoriteToolsRoutes())
      .route("/experimental/tool", toolRoutes())
      .route("/path", pathRoutes())
      .route("/session", sessionRoutes())
      .route("/command", commandRoutes())
      .route("/find", findRoutes())
      .route("/file", fileRoutes())
      .route("/log", logRoutes())
      .route("/agent", agentRoutes())
      .route("/mcp", mcpRoutes())
      .route("/lsp", lspRoutes())
      .route("/formatter", formatterRoutes())
      .route("/plugins", pluginRoutes())
      .route("/ui", uiRoutes())
      .route("/tui", tuiRoutes())
      .route("/tui/control", TuiRoute)
      .route("/auth", authRoutes())
      .route("/event", eventRoutes())
      .all("/*", async (c) => {
        return proxy(`https://desktop.dev.opencode.ai${c.req.path}`, {
          ...c.req,
          headers: {
            host: "desktop.dev.opencode.ai",
          },
        })
      }),
  )

  export async function openapi() {
    const result = await generateSpecs(App(), {
      documentation: {
        info: {
          title: "opencode",
          version: "1.0.0",
          description: "opencode api",
        },
        openapi: "3.1.1",
      },
    })
    return result
  }

  export function listen(opts: { port: number; hostname: string }) {
    const server = Bun.serve({
      port: opts.port,
      hostname: opts.hostname,
      idleTimeout: 0,
      fetch: App().fetch,
    })
    return server
  }
}
