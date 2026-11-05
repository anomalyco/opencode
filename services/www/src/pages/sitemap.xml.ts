import type { APIRoute } from "astro"
import { renderSitemap } from "../docs/lib/sitemap"

export const prerender = true

export const GET: APIRoute = ({ site }) =>
  new Response(renderSitemap(site ?? new URL("https://opencode.ai")), {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  })
