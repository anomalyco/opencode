import type { APIRoute } from "astro"
import { getCollection } from "astro:content"

export const GET: APIRoute = async ({ params }) => {
  const slug = params.slug || "index"
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
