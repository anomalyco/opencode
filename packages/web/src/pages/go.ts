import type { APIRoute } from "astro"

// The Go docs moved to the V2 Console docs, which only exist on the main site, so the target is absolute for
// requests on docs.opencode.ai.
export const ALL: APIRoute = (ctx) => ctx.redirect(new URL("/v2/docs/console/go/", import.meta.env.SITE).href, 302)
