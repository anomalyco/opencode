import { createFileRoute } from "@tanstack/react-router"
import { createFromSource } from "fumadocs-core/search/server"
import { source } from "@/lib/source"

const search = createFromSource(source, {
  language: "english",
})

export const Route = createFileRoute("/api/search")({
  server: {
    handlers: {
      GET: ({ request }) => search.GET(request),
    },
  },
})
