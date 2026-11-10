import type { createMiddleware } from "@solidjs/start/middleware"
import { Resource } from "#resource"

// dev.opencode.ai runs every merge to dev, and search engines must never list it in place of
// opencode.ai. Every response there asks them not to index it: the Worker's (pages, Markdown,
// redirects, errors) through this middleware, and the static assets the Worker never sees through
// the rule script/build.ts adds to dev's _headers. robots.txt keeps allowing the crawl, or crawlers
// would never see the header and dev pages already in an index would stay there.

type Middleware = ReturnType<typeof createMiddleware>[number]

/** The headers every response from a stage carries: none in production. */
export function stageHeaders(stage: "dev" | "production"): Record<string, string> {
  return stage === "dev" ? { "X-Robots-Tag": "noindex, nofollow" } : {}
}

// h3 adds the prepared headers to whatever a route returns, and the error headers to a status of 400 or more.
export const noindexDev: Middleware = (event, next) => {
  Object.entries(stageHeaders(Resource.App.stage)).forEach(([name, value]) => {
    event.res.headers.set(name, value)
    event.res.errHeaders.set(name, value)
  })
  return next()
}
