import { Hono } from "hono"
import { Instance } from "../../project/instance"
import { InstanceBootstrap } from "../../project/bootstrap"
import { HttpApiApp } from "../../server/routes/instance/httpapi/server"
import { WorkspaceServerRoutes } from "./routes"
import { WorkspaceContext } from "../workspace-context"
import { WorkspaceID } from "../schema"

export namespace WorkspaceServer {
  export function App() {
    const sessionHandler = HttpApiApp.webHandler().handler
    const session = (request: Request) => sessionHandler(request, HttpApiApp.context)

    return new Hono()
      .use(async (c, next) => {
        const rawWorkspaceID = c.req.query("workspace") || c.req.header("x-opencode-workspace")
        const raw = c.req.query("directory") || c.req.header("x-opencode-directory")
        if (rawWorkspaceID == null) {
          throw new Error("workspaceID parameter is required")
        }
        if (raw == null) {
          throw new Error("directory parameter is required")
        }

        const directory = (() => {
          try {
            return decodeURIComponent(raw)
          } catch {
            return raw
          }
        })()

        return WorkspaceContext.provide({
          workspaceID: WorkspaceID.make(rawWorkspaceID),
          async fn() {
            return Instance.provide({
              directory,
              init: InstanceBootstrap,
              async fn() {
                return next()
              },
            })
          },
        })
      })
      .all("/session", (c) => session(c.req.raw))
      .all("/session/*", (c) => session(c.req.raw))
      .route("/", WorkspaceServerRoutes())
  }

  export function Listen(opts: { hostname: string; port: number }) {
    return Bun.serve({
      hostname: opts.hostname,
      port: opts.port,
      fetch: App().fetch,
    })
  }
}
