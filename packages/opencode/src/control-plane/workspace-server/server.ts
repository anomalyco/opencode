import { Hono } from "hono"
import { Instance } from "../../project/instance"
import { InstanceBootstrap } from "../../project/bootstrap"
import { SessionRoutes } from "../../server/routes/session"
import { WorkspaceServerRoutes } from "./routes"
import { WorkspaceContext } from "../workspace-context"
import { WorkspaceID } from "../schema"

export namespace WorkspaceServer {
  export function App() {
    const session = new Hono()
      .use(async (c, next) => {
        // Right now, we need handle all requests because we don't
        // have syncing. In the future all GET requests will handled
        // by the control plane
        //
        // if (c.req.method === "GET") return c.notFound()
        await next()
      })
      .route("/", SessionRoutes())

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
      .route("/session", session)
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
