import type { createMiddleware } from "@solidjs/start/middleware"
import { Resource } from "@opencode/stats-core/resource"

// Only production may be indexed: dev.opencode.ai and the personal stages run unreleased builds, and
// search engines must never list them in place of opencode.ai. Every response there asks them not
// to index it: the Worker's through this middleware, and the static assets the Worker never sees
// through the rule vite.config.ts adds to those stages' _headers.

type Middleware = ReturnType<typeof createMiddleware>[number]

/**
 * The headers every response from this stage carries: none in production, or when STAGE is unset (`vite dev` on its
 * own). services/data sets STAGE for the build as well as on the Worker.
 */
export function stageHeaders(): Record<string, string> {
  if (!process.env.STAGE) return {}
  return Resource.App.stage === "production" ? {} : { "X-Robots-Tag": "noindex, nofollow" }
}

// h3 adds the prepared headers to whatever a route returns, and the error headers to a status of 400 or more.
export const noindexOutsideProduction: Middleware = (event, next) => {
  Object.entries(stageHeaders()).forEach(([name, value]) => {
    event.res.headers.set(name, value)
    event.res.errHeaders.set(name, value)
  })
  return next()
}
