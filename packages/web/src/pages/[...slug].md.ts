import type { APIRoute } from "astro"
import { getCollection } from "astro:content"

function notFoundText(locals: unknown) {
  if (typeof locals !== "object" || locals === null || !("t" in locals)) {
    return "share.not_found"
  }
  const t = (locals as { t?: unknown }).t
  if (typeof t !== "function") {
    return "share.not_found"
  }
  const text = t("share.not_found")
  if (typeof text === "string" && text.length > 0) {
    return text
  }
  return "share.not_found"
}

export const GET: APIRoute = async ({ params, locals }) => {
  const slug = params.slug || "index"
  const docs = await getCollection("docs")
  const doc = docs.find((d) => d.id === slug)
  const notFound = notFoundText(locals)

  if (!doc) {
    return new Response(notFound, { status: 404, statusText: notFound })
  }

  return new Response(doc.body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  })
}
