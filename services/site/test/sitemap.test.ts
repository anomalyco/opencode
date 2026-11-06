import { describe, expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
// SolidStart's own file router, which builds the route manifest the app serves /sitemap-pages.xml from.
import { DEFAULT_EXTENSIONS } from "../node_modules/@solidjs/start/dist/config/constants.js"
import { SolidStartServerFileRouter } from "../node_modules/@solidjs/start/dist/config/fs-router.js"
import { config } from "~/config"
import type { ChangelogRelease } from "~/lib/changelog"
import { LOCALES, strip } from "~/lib/language"
import { legalDocuments } from "~/lib/legal"
import {
  sitemapExclusion,
  sitemapExclusions,
  sitemapFiles,
  sitemapIndexXml,
  sitemapLimits,
  sitemapPages,
  sitemapXml,
  unlistedRoutes,
} from "~/lib/sitemap"

const router = new SolidStartServerFileRouter({
  dir: fileURLToPath(new URL("../src/routes", import.meta.url)),
  extensions: DEFAULT_EXTENSIONS,
})
const manifest: { path: string; page?: boolean }[] = await router.getRoutes()
const routes = manifest.filter((route) => route.page).map((route) => route.path)

const release = (index: number): ChangelogRelease => ({
  tag: `v2.0.${index}`,
  name: `v2.0.${index}`,
  // One release a day, so none merge.
  date: new Date(Date.UTC(2026, 0, 1) + index * 86_400_000).toISOString(),
  url: `https://github.com/anomalyco/opencode/releases/tag/v2.0.${index}`,
  highlights: [],
  sections: [],
  notes: {
    features: [{ title: `Feature ${index}`, body: "", areas: ["Core"], prs: [], credits: [] }],
    breaking: [],
    improved: [{ text: `Improvement ${index}`, areas: ["Core"], prs: [], credits: [] }],
    fixed: [],
    media: [],
  },
})
const releases = Array.from({ length: 3 }, (_, index) => release(index + 1)).toReversed()
const xml = sitemapXml(sitemapPages(routes, { releases }))
const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])

describe("sitemap", () => {
  test("/sitemap.xml is an index of this site's sitemaps, with the pages and the V2 docs at /docs", () => {
    const index = sitemapIndexXml(sitemapFiles)
    const files = [...index.matchAll(/<sitemap><loc>([^<]+)<\/loc><\/sitemap>/g)].map((match) => match[1])
    expect(index).toContain('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    expect(files).toEqual(sitemapFiles.map((file) => `${config.baseUrl}${file}`))
    expect(files).toContain(`${config.baseUrl}/sitemap-pages.xml`)
    expect(files).toContain(`${config.baseUrl}/docs/sitemap.xml`)
    expect(files.some((file) => file === `${config.baseUrl}/sitemap.xml`)).toBe(false)
  })

  test("lists every public page route, or excludes it with a reason", () => {
    expect(unlistedRoutes(routes)).toEqual([])
    const listed = new Set(urls.map((url) => strip(new URL(url).pathname)))
    const missing = routes
      .map((path) => (path.length > 1 ? path.replace(/\/$/, "") : path))
      .filter((path) => !/[:*]/.test(path) && !sitemapExclusion(path) && !listed.has(path))
    expect(missing).toEqual([])
  })

  test("every exclusion still matches a route", () => {
    const stale = Object.keys(sitemapExclusions).filter(
      (pattern) =>
        !routes.some((path) =>
          pattern.endsWith("/*") ? path.startsWith(pattern.slice(0, -2)) : path.replace(/(.)\/$/, "$1") === pattern,
        ),
    )
    expect(stale).toEqual([])
  })

  test("every URL is served by a page route", () => {
    const patterns = routes
      .filter((path) => !sitemapExclusion(path.replace(/(.)\/$/, "$1")))
      .map((path) => ({
        path,
        regex: new RegExp(
          `^${path
            .replace(/(.)\/$/, "$1")
            .replace(/\*[^/]*/g, ".+")
            .replace(/:[^/]+/g, "[^/]+")}$`,
        ),
      }))
    const tags = new Set(releases.map((item) => item.tag))
    const unserved = urls.filter((url) => {
      expect(url.startsWith(`${config.baseUrl}/`)).toBe(true)
      const path = strip(new URL(url).pathname)
      // A dynamic URL must come from the data its page reads: the catch-all 404 is excluded above.
      const tag = path.match(/^\/changelog\/([^/]+)$/)?.[1]
      if (tag) return !tags.has(tag)
      return !patterns.some((pattern) => pattern.regex.test(path))
    })
    expect(unserved).toEqual([])
    expect(new Set(urls).size).toBe(urls.length)
  })

  test("lists localized pages in every locale with hreflang alternates, and legal pages once", () => {
    expect(urls.filter((url) => strip(new URL(url).pathname) === "/")).toHaveLength(LOCALES.length)
    expect(xml).toContain(`<xhtml:link rel="alternate" hreflang="zh-Hans" href="${config.baseUrl}/zh/product"/>`)
    expect(xml).toContain(`<xhtml:link rel="alternate" hreflang="x-default" href="${config.baseUrl}/product"/>`)
    legalDocuments.forEach((document) => {
      expect(urls.filter((url) => url.endsWith(document.path))).toEqual([`${config.baseUrl}${document.path}`])
    })
    expect(xml).toContain(`<loc>${config.baseUrl}/changelog/v2.0.3</loc><lastmod>2026-01-04</lastmod>`)
    expect(urls.some((url) => /\/(dev|workspace|legal\/subprocessors)(\/|$)/.test(url))).toBe(false)
  })

  test("lists the changelog once, in English, with only en and x-default alternates", () => {
    const changelog = urls.filter((url) => /\/changelog(\/|$)/.test(new URL(url).pathname))
    expect(changelog).toEqual([
      `${config.baseUrl}/changelog`,
      ...releases.map((item) => `${config.baseUrl}/changelog/${item.tag}`),
    ])
    const entry = xml.split("\n").find((line) => line.includes(`<loc>${config.baseUrl}/changelog/v2.0.3</loc>`))
    expect(
      [...(entry ?? "").matchAll(/hreflang="([^"]+)" href="([^"]+)"/g)].map((match) => [match[1], match[2]]),
    ).toEqual([
      ["en", `${config.baseUrl}/changelog/v2.0.3`],
      ["x-default", `${config.baseUrl}/changelog/v2.0.3`],
    ])
  })

  test("lists the font once, in English, with only en and x-default alternates", () => {
    expect(urls.filter((url) => new URL(url).pathname.endsWith("/font"))).toEqual([`${config.baseUrl}/font`])
    expect(xml).toContain(
      `<url><loc>${config.baseUrl}/font</loc><xhtml:link rel="alternate" hreflang="en" href="${config.baseUrl}/font"/><xhtml:link rel="alternate" hreflang="x-default" href="${config.baseUrl}/font"/></url>`,
    )
  })

  test("leaves out /zen, which redirects to the Console", () => {
    expect(urls.some((url) => /\/zen(\/|$)/.test(new URL(url).pathname))).toBe(false)
  })

  test("stays inside the single-file limits with the most releases the changelog loads", () => {
    const most = sitemapXml(
      sitemapPages(routes, { releases: Array.from({ length: 300 }, (_, index) => release(index + 1)) }),
    )
    expect(most.match(/<loc>/g)?.length ?? 0).toBeLessThan(sitemapLimits.urls)
    expect(new TextEncoder().encode(most).length).toBeLessThan(sitemapLimits.bytes)
  })
})
