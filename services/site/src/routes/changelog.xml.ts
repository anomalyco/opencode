import type { APIEvent } from "@solidjs/start/server"
import { config } from "~/config"
import type { ChangelogData } from "~/lib/changelog"
import { feedWait, loadChangelog } from "~/lib/changelog-releases"
import {
  areaKeys,
  areaLabel,
  changelogQuery,
  changelogView,
  type ChangelogEntry,
  type ChangelogNote,
} from "~/lib/changelog-notes"

const ok = "public, max-age=60, s-maxage=300, stale-while-revalidate=86400, stale-if-error=86400"
const error = "public, max-age=1, s-maxage=60, stale-while-revalidate=600, stale-if-error=86400"

/**
 * The changelog as RSS 2.0, from the same releases as /changelog.json: the newest 30 entries, each
 * linking to its page, with its notes as HTML. `?area=desktop,terminal` filters it like the page.
 */
export async function GET(event: APIEvent) {
  const query = new URL(event.request.url).searchParams
  const result = await loadChangelog(feedWait).catch((): ChangelogData => ({ ok: false, releases: [] }))
  const view = changelogView(result.releases, { filter: areaKeys(query.getAll("area")), size: 30 })
  const page = `${config.baseUrl}/changelog${changelogQuery({ filter: view.filter })}`
  const labels = view.areas.filter((area) => view.filter.includes(area.key)).map((area) => area.label)
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
<title>${escape(`OpenCode changelog${labels.length > 0 ? `: ${labels.join(", ")}` : ""}`)}</title>
<link>${escape(page)}</link>
<atom:link href="${escape(`${config.baseUrl}/changelog.xml${changelogQuery({ filter: view.filter })}`)}" rel="self" type="application/rss+xml"/>
<description>New updates and improvements to OpenCode</description>
<language>en</language>
${view.entries.map(item).join("\n")}
</channel>
</rss>
`
  return new Response(xml, {
    status: result.ok ? 200 : 503,
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": result.ok && !result.stale ? ok : error,
      "Access-Control-Allow-Origin": "*",
    },
  })
}

function item(entry: ChangelogEntry) {
  const url = `${config.baseUrl}/changelog/${entry.releases[0].tag}`
  return `<item>
<title>${escape(plain(entry.title))}</title>
<link>${url}</link>
<guid isPermaLink="true">${url}</guid>
<pubDate>${new Date(`${entry.date}T12:00:00Z`).toUTCString()}</pubDate>
<description>${escape(plain(entry.summary || entry.title))}</description>
<content:encoded><![CDATA[${html(entry, url).replaceAll("]]>", "]]&gt;")}]]></content:encoded>
</item>`
}

/** An entry as simple HTML for feed readers: summary, highlights, then the lists. */
function html(entry: ChangelogEntry, url: string) {
  const list = (title: string, notes: ChangelogNote[]) =>
    notes.length > 0 &&
    `<h3>${title}</h3><ul>${notes
      .map(
        (note) =>
          `<li>${note.areas.length > 0 ? `<strong>${escape(note.areas.map(areaLabel).join(", "))}:</strong> ` : ""}${inline(note.text)}</li>`,
      )
      .join("")}</ul>`
  return [
    entry.summary && `<p>${inline(entry.summary)}</p>`,
    ...entry.features.map(
      (feature) => `<h3>${inline(feature.title)}</h3>${feature.body ? `<p>${inline(feature.body)}</p>` : ""}`,
    ),
    entry.hiddenFeatures > 0 &&
      `<p><a href="${escape(url)}">See all highlights in ${escape(entry.releases[0].tag)}</a></p>`,
    entry.breaking.length > 0 &&
      `<h3>Breaking changes</h3>${entry.breaking.map((change) => `<p>${change.title ? `<strong>${inline(change.title)}</strong> ` : ""}${inline(change.body)}</p>`).join("")}`,
    list("Improvements", entry.improved),
    list("Fixes", entry.fixed),
    `<p>Released in ${entry.releases.map((release) => `<a href="${escape(release.url)}">${escape(release.tag)}</a>`).join(", ")}</p>`,
  ]
    .filter(Boolean)
    .join("\n")
}

/** The inline Markdown release notes use (code, links, bold) as HTML. */
function inline(text: string) {
  return escape(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>')
}

function plain(text: string) {
  return text
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
}

function escape(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
