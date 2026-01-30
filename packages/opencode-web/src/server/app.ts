import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import { HTTPException } from "hono/http-exception"
import { AuthRoutes } from "./routes/auth"
import { ProjectRoutes } from "./routes/projects"
import { SessionRoutes } from "./routes/sessions"
import { TaskRoutes } from "./routes/tasks"

export function createApp() {
  const app = new Hono()

  // Global middleware
  app.use("*", logger())
  app.use(
    "*",
    cors({
      origin: "*", // Configure this properly in production
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      exposeHeaders: ["Content-Length"],
      maxAge: 86400,
      credentials: true,
    })
  )

  // Error handling
  app.onError((err, c) => {
    console.error("Request error:", err)

    if (err instanceof HTTPException) {
      return c.json(
        {
          error: {
            message: err.message,
            status: err.status,
          },
        },
        err.status
      )
    }

    return c.json(
      {
        error: {
          message: err instanceof Error ? err.message : "Internal server error",
          status: 500,
        },
      },
      500
    )
  })

  // Health check
  app.get("/health", (c) => {
    return c.json({
      status: "ok",
      timestamp: new Date().toISOString(),
    })
  })

  // API routes
  app.route("/auth", AuthRoutes())
  app.route("/projects", ProjectRoutes())
  app.route("/sessions", SessionRoutes())
  app.route("/tasks", TaskRoutes())

  // 404 handler
  app.notFound((c) => {
    return c.json(
      {
        error: {
          message: "Not found",
          status: 404,
        },
      },
      404
    )
  })

  return app
}
