import { Hono } from "hono"
import { Instance } from "../../project/instance"
import { InstanceBootstrap } from "../../project/bootstrap"
import { localProject } from "../../project/local-project"
import { SessionRoutes } from "../../server/routes/session"
import { WorkspaceServerRoutes } from "./routes"
import { WorkspaceContext } from "../workspace-context"
import { WorkspaceID } from "../schema"
import { Filesystem } from "../../util/filesystem"

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
        if (rawWorkspaceID == null) {
          throw new Error("workspaceID parameter is required")
        }
        const root = (() => {
          const fromEnv = process.env.OPENCODE_INSTANCE_ROOT?.trim()
          if (fromEnv) return Filesystem.resolve(fromEnv)
          return Filesystem.resolve(process.cwd())
        })()
        const project = localProject(root)
        return WorkspaceContext.provide({
          workspaceID: WorkspaceID.make(rawWorkspaceID),
          async fn() {
            return Instance.provide({
              project,
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
