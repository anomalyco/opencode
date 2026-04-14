#!/usr/bin/env bun
import { readdir, writeFile } from "fs/promises"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { config } from "../src/config.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const BASE_URL = config.baseUrl
const PUBLIC_DIR = join(__dirname, "../public")
const ROUTES_DIR = join(__dirname, "../src/routes")
const DOCS_DIR = join(__dirname, "../../../web/src/content/docs")

interface SitemapEntry {
  url: string
  priority: number
  changefreq: string
}

async function getMainRoutes(): Promise<SitemapEntry[]> {
  const routes: SitemapEntry[] = []

  // Add main static routes
  const staticRoutes = [
    { path: "/", priority: 1.0, changefreq: "daily" },
    { path: "/enterprise", priority: 0.8, changefreq: "weekly" },
    { path: "/brand", priority: 0.6, changefreq: "monthly" },
    { path: "/zen", priority: 0.8, changefreq: "weekly" },
  ]

  for (const route of staticRoutes) {
    routes.push({
      url: `${BASE_URL}${route.path}`,
      priority: route.priority,
      changefreq: route.changefreq,
    })
  }

  return routes
}

async function getDocsRoutes(): Promise<SitemapEntry[]> {
  const routes: SitemapEntry[] = []

  try {
    const files = await readdir(DOCS_DIR)

    for (const file of files) {
      if (!file.endsWith(".mdx")) continue

      const slug = file.replace(".mdx", "")
      const path = slug === "index" ? "/docs/" : `/docs/${slug}`

      routes.push({
        url: `${BASE_URL}${path}`,
        priority: slug === "index" ? 0.9 : 0.7,
        changefreq: "weekly",
      })
    }
  } catch (error) {
    console.error("Error reading docs directory:", error)
  }

  return routes
}

function generateSitemapXML(entries: SitemapEntry[]): string {
  const urls = entries
    .map(
      (entry) => `  <url>
    <loc>${entry.url}</loc>
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`,
    )
    .join("\n")

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`
}

async function main() {
  console.log("Generating sitemap...")

  const mainRoutes = await getMainRoutes()
  const docsRoutes = await getDocsRoutes()

  const allRoutes = [...mainRoutes, ...docsRoutes]

  console.log(`Found ${mainRoutes.length} main routes`)
  console.log(`Found ${docsRoutes.length} docs routes`)
  console.log(`Total: ${allRoutes.length} routes`)

  const xml = generateSitemapXML(allRoutes)

  const outputPath = join(PUBLIC_DIR, "sitemap.xml")
  await writeFile(outputPath, xml, "utf-8")

  console.log(`✓ Sitemap generated at ${outputPath}`)
}

main()
