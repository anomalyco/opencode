import { getStatsHomeData, getStatsModelUpdates } from "@opencode/data-core/domain/home"
import { runtime } from "@opencode/data-core/runtime"
import {
  canonicalFamilyComparisonPath,
  canonicalModelComparisonPath,
  comparisonFamilies,
  comparisonSitemapModels,
  latestFamilyComparisonPath,
  resolveComparisonFamily,
} from "../lib/comparison-pages"
import { baseUrl, LOCALES, localizedUrl, tag } from "../lib/language"
import { catalogModelPath, findModelCatalogEntry, loadModelCatalog, type ModelCatalogEntry } from "./model-catalog"

type SitemapEntry = {
  path: string
  lastmod?: string
}

export async function GET() {
  const [catalog, stats, updates] = await Promise.all([
    loadModelCatalog(),
    runtime.runPromise(getStatsHomeData()).catch(() => undefined),
    runtime.runPromise(getStatsModelUpdates()).catch(() => []),
  ])
  const snapshots = updates.reduce<Record<string, number>>((result, update) => {
    const id = findModelCatalogEntry(catalog, update.model, update.provider)?.id
    if (id) result[id] = Math.max(result[id] ?? 0, update.updatedAt)
    return result
  }, {})
  // A model's page changes with its catalog entry and its own stats, not with every stats refresh.
  const modelDates = (model: ModelCatalogEntry) => [snapshots[model.id], model.lastUpdated ?? model.releaseDate]
  const families = comparisonFamilies.flatMap((family) => {
    const resolved = resolveComparisonFamily(catalog, family.slug)
    return resolved ? [resolved] : []
  })
  const familyComparisons = families.flatMap((first, index) =>
    families.slice(index + 1).map((second) => ({
      path: canonicalFamilyComparisonPath(first, second),
      lastmod: sitemapDate(...modelDates(first.model), ...modelDates(second.model)),
    })),
  )
  const models = comparisonSitemapModels(catalog, stats?.leaderboard["All Users"]["2M"])
  const modelComparisons = models.flatMap((first, index) =>
    models.slice(index + 1).flatMap((second) => {
      if (latestFamilyComparisonPath(catalog, first, second)) return []
      return [
        {
          path: canonicalModelComparisonPath(first, second),
          lastmod: sitemapDate(...modelDates(first), ...modelDates(second)),
        },
      ]
    }),
  )
  const labPages = catalog.labs.map((lab) => ({
    path: `/data/${lab.id}`,
    lastmod: sitemapDate(...lab.models.flatMap(modelDates)),
  }))
  // Skip entries whose URL resolves to another model, such as stats aliases.
  const modelPages = [...catalog.models, ...(catalog.aliases ?? [])]
    .filter((model) => findModelCatalogEntry(catalog, model.slug, model.lab)?.id === model.id)
    .map((model) => ({
      path: catalogModelPath(model),
      lastmod: sitemapDate(...modelDates(model)),
    }))
  const entries = uniqueSitemapEntries([
    { path: "/data/", lastmod: sitemapDate(stats?.updatedAt) },
    {
      path: "/data/compare",
      lastmod: sitemapDate(...catalog.models.map((model) => model.lastUpdated ?? model.releaseDate)),
    },
    ...labPages,
    ...modelPages,
    ...familyComparisons,
    ...modelComparisons,
  ])

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
    <loc>${escapeXml(new URL(entry.path, baseUrl).toString())}</loc>${alternates(entry.path)}${
      entry.lastmod
        ? `
    <lastmod>${entry.lastmod}</lastmod>`
        : ""
    }
  </url>`,
    )
    .join("\n")
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>`
}

// The same hreflang alternates as the page's own head (component/locale-links.tsx).
function alternates(path: string) {
  return [...LOCALES.map((locale) => [tag(locale), locale] as const), ["x-default", "en"] as const]
    .map(
      ([hreflang, locale]) => `
    <xhtml:link rel="alternate" hreflang="${hreflang}" href="${escapeXml(localizedUrl(locale, path))}"/>`,
    )
    .join("")
}

function sitemapDate(...values: (string | number | undefined | null)[]) {
  const dates = values.flatMap((value) => {
    if (!value) return []
    const date = new Date(value)
    // A future release date says nothing about when the page last changed.
    return Number.isNaN(date.getTime()) || date.getTime() > Date.now() ? [] : [date]
  })
  if (dates.length === 0) return undefined
  return new Date(Math.max(...dates.map((date) => date.getTime()))).toISOString().slice(0, 10)
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}
