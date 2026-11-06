import { config } from "~/config"
import { legalFeedEntries } from "~/lib/legal-documents"

/**
 * Changes to the published legal documents as RSS 2.0 (it was Atom at first; the URL stays, and
 * feed readers read either): one item per text version, linking the document, with the GitHub diff
 * as the comments link.
 */
export function GET() {
  const entries = legalFeedEntries()
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>OpenCode legal updates</title>
<link>${config.baseUrl}/legal</link>
<atom:link href="${config.baseUrl}/legal/feed.xml" rel="self" type="application/rss+xml"/>
<description>Changes to the OpenCode Privacy Policy and Terms of Use.</description>
<language>en</language>
${entries[0] ? `<lastBuildDate>${new Date(`${entries[0].date}T00:00:00Z`).toUTCString()}</lastBuildDate>\n` : ""}${entries
    .map(
      (entry) => `<item>
<title>${escape(entry.title)}</title>
<link>${escape(entry.page)}</link>
<guid isPermaLink="false">${escape(entry.id)}</guid>
<pubDate>${new Date(`${entry.date}T00:00:00Z`).toUTCString()}</pubDate>
<description>${escape(entry.summary)}</description>
<comments>${escape(entry.change)}</comments>
</item>`,
    )
    .join("\n")}
</channel>
</rss>
`
  return new Response(body, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=3600",
    },
  })
}

function escape(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
