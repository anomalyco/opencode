import { getStatsHomeData } from "@opencode-ai/stats-core/domain/home"
import { runtime } from "@opencode-ai/stats-core/runtime"
import {
  canonicalFamilyComparisonPath,
  canonicalModelComparisonPath,
  comparisonFamilies,
  comparisonSitemapModels,
  latestFamilyComparisonPath,
  resolveComparisonFamily,
} from "../lib/comparison-pages"
import { baseUrl } from "../lib/language"
import { loadModelCatalog } from "./model-catalog"

type SitemapEntry = {
  path: string
  lastmod?: string
}

export async function GET() {
  const [catalog, stats] = await Promise.all([
    loadModelCatalog(),
    runtime.runPromise(getStatsHomeData()).catch(() => undefined),
  ])
  const lastmod = sitemapDate(
    stats?.updatedAt,
    ...catalog.models.map((model) => model.lastUpdated ?? model.releaseDate),
  )
  const families = comparisonFamilies.flatMap((family) => {
    const resolved = resolveComparisonFamily(catalog, family.slug)
    return resolved ? [resolved] : []
  })
  const familyComparisons = families.flatMap((first, index) =>
    families.slice(index + 1).map((second) => ({
      path: canonicalFamilyComparisonPath(first, second),
      lastmod: sitemapDate(
        stats?.updatedAt,
        first.model.lastUpdated ?? first.model.releaseDate,
        second.model.lastUpdated ?? second.model.releaseDate,
      ),
    })),
  )
  const models = comparisonSitemapModels(catalog, stats?.leaderboard["All Users"]["2M"])
  const modelComparisons = models.flatMap((first, index) =>
    models.slice(index + 1).flatMap((second) => {
      if (latestFamilyComparisonPath(catalog, first, second)) return []
      return [
        {
          path: canonicalModelComparisonPath(first, second),
          lastmod: sitemapDate(
            stats?.updatedAt,
            first.lastUpdated ?? first.releaseDate,
            second.lastUpdated ?? second.releaseDate,
          ),
        },
      ]
    }),
  )
  const entries = uniqueSitemapEntries([{ path: "/data/compare", lastmod }, ...familyComparisons, ...modelComparisons])

  return new Response(sitemapXml(entries), {
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
      "Content-Type": "application/xml; charset=utf-8",
    },
  })
}

function uniqueSitemapEntries(entries: SitemapEntry[]) {
  return Object.values(
    entries.reduce<Record<string, SitemapEntry>>((result, entry) => {
      result[entry.path] = entry
      return result
    }, {}),
  ).toSorted((a, b) => a.path.localeCompare(b.path))
}

function sitemapXml(entries: SitemapEntry[]) {
  const urls = entries
    .map(
      (entry) => `  <url>
    <loc>${escapeXml(new URL(entry.path, baseUrl).toString())}</loc>${
      entry.lastmod
        ? `
    <lastmod>${entry.lastmod}</lastmod>`
        : ""
    }
  </url>`,
    )
    .join("\n")
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`
}

function sitemapDate(...values: (string | undefined | null)[]) {
  const dates = values.flatMap((value) => {
    if (!value) return []
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? [] : [date]
  })
  if (dates.length === 0) return undefined
  return new Date(Math.min(Date.now(), Math.max(...dates.map((date) => date.getTime())))).toISOString().slice(0, 10)
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}
