import type { APIRoute } from "astro"
import { getCollection } from "astro:content"
import starlightConfig from "virtual:starlight/user-config"

export const GET: APIRoute = async ({ params }) => {
  const locales = starlightConfig.locales ?? {}
  const localeKeys = Object.keys(locales).filter((k) => k !== "root")

  const requestedSlug = params.slug || "index"
  let slug = String(requestedSlug).replace(/^\/+|\/+$/g, "")
  if (slug === "" || slug === "en") slug = "index"
  if (localeKeys.includes(slug)) slug = `${slug}/index`
  if (slug.startsWith("en/")) slug = slug.slice(3) || "index"
  const docs = await getCollection("docs")
  const doc = docs.find((d) => d.id === slug)

  if (!doc) {
    return new Response("Not found", { status: 404 })
  }

  return new Response(doc.body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  })
}
