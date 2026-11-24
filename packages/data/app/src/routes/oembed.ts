import type { APIEvent } from "@solidjs/start/server"
import { dataFlag } from "../lib/flag"
import { baseUrl } from "../lib/language"
import { embedSize, embedSnippet, readEmbed, shareTitles } from "../share/embed"

/**
 * oEmbed (oembed.com) for OpenCode Data, so a link pasted into Notion, WordPress, Ghost or Medium turns into the card.
 * An embed's URL (/data/embed/<section>?...) gives that card; the page's own URL gives the section in its fragment,
 * or Top Models. Only JSON.
 */
export function GET(event: APIEvent) {
  if (!dataFlag("share")) return Response.json({ error: "Not found" }, { status: 404 })
  const query = new URL(event.request.url).searchParams
  if (query.get("format") && query.get("format") !== "json") return new Response("Only JSON", { status: 501 })
  const target = parseTarget(query.get("url"))
  if (!target) return Response.json({ error: "Not an OpenCode Data URL" }, { status: 404 })
  const embed = readEmbed(target.section, target.params)
  if (!embed.section) return Response.json({ error: "Not an OpenCode Data section" }, { status: 404 })
  const maxWidth = Number(query.get("maxwidth")) || undefined
  const size = embedSize(embed.options.size, maxWidth)
  const src = new URL(`/data/embed/${embed.section}`, baseUrl)
  src.search = target.params.toString()
  const title = shareTitles[embed.section]
  return Response.json(
    {
      version: "1.0",
      type: "rich",
      provider_name: "OpenCode Data",
      provider_url: `${baseUrl}/data/`,
      title: `${title} · OpenCode Data`,
      html: embedSnippet(src.toString(), title, embed.options.size),
      width: size.width,
      height: size.height,
    },
    { headers: { "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" } },
  )
}

function parseTarget(value: string | null) {
  if (!value || !URL.canParse(value)) return undefined
  const url = new URL(value)
  if (url.hostname !== new URL(baseUrl).hostname && url.hostname !== "localhost") return undefined
  const embed = /\/data\/embed\/([\w-]+)\/?$/.exec(url.pathname)
  if (embed) return { section: embed[1]!, params: url.searchParams }
  if (!/\/data\/?$/.test(url.pathname)) return undefined
  return { section: url.hash.slice(1) || "top-models", params: url.searchParams }
}
