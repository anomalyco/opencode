import { Hono } from "hono"
import { z } from "zod"

type Bindings = {
  CF_ENV: string
}

const app = new Hono<{ Bindings: Bindings }>()

// Request schema for validation
const TestRequest = z.object({
  message: z.string().min(1),
})

// Middleware to log incoming requests with domain info
app.use("*", async (c, next) => {
  const url = new URL(c.req.url)
  const hostname = url.hostname
  const path = c.req.path
  const date = new Date().toISOString()
  console.log(`[ ${date} ]:  Request received:`)
  console.log(`  Hostname: ${hostname}`)
  console.log(`  Path: ${path}`)
  console.log(`  Method: ${c.req.method}`)
  console.log(`  Custom Domain Header: ${c.req.header("CF-Worker-Custom-Domain") || "N/A"}`)

  await next()
})

// Root endpoint - shows all available routes
app.get("/", (c) => {
  return c.json({
    message: "Worker Test API",
    endpoints: {
      "/": "This help page",
      "/health": "Health check endpoint",
      "/domain-info": "Get domain and routing information",
      "/echo": "Echo back request details (POST with JSON)",
      "/test": "Test endpoint with validation",
    },
  })
})

// Health check endpoint
app.get("/health", (c) => {
  return c.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    environment: c.env.CF_ENV || "development",
  })
})

// Domain and routing information endpoint
// This helps verify custom domain routing
app.get("/domain-info", (c) => {
  const url = new URL(c.req.url)

  return c.json({
    request: {
      url: c.req.url,
      hostname: url.hostname,
      path: c.req.path,
      method: c.req.method,
      headers: c.req.header,
    },
    cloudflare: {
      // These headers are added by Cloudflare Workers
      cf: {
        "CF-Connecting-IP": c.req.header("CF-Connecting-IP"),
        "CF-Worker-Custom-Domain": c.req.header("CF-Worker-Custom-Domain"),
        "CF-Ray": c.req.header("CF-Ray"),
        "CF-IPCountry": c.req.header("CF-IPCountry"),
        "CF-Request-ID": c.req.header("CF-Request-ID"),
      },
    },
    routing: {
      // Custom domains are identified by the Host header
      isCustomDomain: c.req.header("CF-Worker-Custom-Domain") === "true",
      hostname: url.hostname,
      path: url.pathname,
    },
    timestamp: new Date().toISOString(),
  })
})

// Echo endpoint - validates and echoes back the request
app.post("/echo", async (c) => {
  try {
    const body = await c.req.json()
    return c.json({
      received: body,
      timestamp: new Date().toISOString(),
      hostname: new URL(c.req.url).hostname,
    })
  } catch (error) {}
  return c.json({ error: "Invalid JSON" }, 400)
})

// Test endpoint with validation
app.post("/test", async (c) => {
  try {
    const body = await c.req.json()
    const validated = TestRequest.parse(body)

    return c.json({
      success: true,
      message: validated.message,
      validated: true,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json(
        {
          success: false,
          errors: error,
        },
        400,
      )
    }
    return c.json({ error: "Invalid request" }, 400)
  }
})

// Route pattern testing - matches /api/* paths
app.get("/api/*", (c) => {
  const path = c.req.path
  return c.json({
    message: "API route matched",
    path: path,
    pattern: "/api/*",
    timestamp: new Date().toISOString(),
  })
})

// 404 handler
app.notFound((c) => {
  return c.json(
    {
      error: "Not Found",
      path: c.req.path,
      hostname: new URL(c.req.url).hostname,
    },
    404,
  )
})

// Error handler
app.onError((err, c) => {
  console.error(`${err}`)
  return c.json(
    {
      error: "Internal Server Error",
      message: err.message,
    },
    500,
  )
})

export default app
