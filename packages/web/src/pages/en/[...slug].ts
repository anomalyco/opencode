import type { APIRoute } from "astro"

export const GET: APIRoute = ({ params, url }) => {
  const slug = params.slug ? String(params.slug).replace(/^\/+|\/+$/g, "") : ""
  const target = slug ? `/docs/${slug}` : "/docs"
  return Response.redirect(new URL(target, url), 302)
}

