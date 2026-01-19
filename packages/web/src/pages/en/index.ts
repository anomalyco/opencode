import type { APIRoute } from "astro"

export const GET: APIRoute = ({ url }) => {
  return Response.redirect(new URL("/docs", url), 302)
}

