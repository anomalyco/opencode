import { Hono } from "hono"
import { SessionRoutes } from "../../server/routes/session"
import { WorkspaceServerRoutes } from "./routes"

export namespace WorkspaceServer {
  export function App() {
    const session = new Hono()
      .use("*", async (c, next) => {
        if (c.req.method === "GET") return c.notFound()
        await next()
      })
      .route("/", SessionRoutes())

    return new Hono().route("/session", session).route("/", WorkspaceServerRoutes())
  }

  export function Listen(opts: { hostname: string; port: number }) {
    return Bun.serve({
      hostname: opts.hostname,
      port: opts.port,
      fetch: App().fetch,
    })
  }
}
