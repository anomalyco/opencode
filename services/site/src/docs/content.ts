import type { Component } from "solid-js"
import type { Locale } from "~/lib/language"
import { latestDocs, v1Docs, type DocsSet } from "./config"
import type { Frontmatter } from "./frontmatter"
import { docsSlug, docsTranslation } from "./lib/navigation"
import type { DocsHeading } from "./rehype-headings"

/** A compiled content page (vite.ts): its content component, frontmatter, headings and Markdown twin. */
export type DocsModule = {
  default: Component<{ components?: Record<string, Component<any>> }>
  frontmatter: Frontmatter
  headings: DocsHeading[]
  markdown: string
  /** A translation whose heading structure no longer matches the English page's (vite.ts). */
  stale: boolean
}

type Loader = () => Promise<DocsModule>

// Loaded on demand: the Worker serves the prerendered pages, so it never evaluates these at start-up.
// Globs take literal patterns, so each set's folder (config.ts `content`) is spelled out here.
const modules = {
  latest: import.meta.glob<DocsModule>("./**/*.mdx", { base: "./content" }),
  v1: import.meta.glob<DocsModule>("./**/*.mdx", { base: "./v1/content" }),
} satisfies Record<DocsSet["id"], unknown>

// The latest docs' files: English pages, and translations in `content/<locale>/...` (navigation.ts
// docsTranslation). The V1 docs' language folders are part of their slugs (`ja/config`).
const latest = Object.entries(modules.latest)
const latestEnglish = latest.filter(([file]) => !docsTranslation(file.slice(2)))
const latestTranslations = latest.flatMap(([file, load]) => {
  const path = file.slice(2)
  const translation = docsTranslation(path)
  return translation ? [{ ...translation, path, load }] : []
})

/** Every content page's loader, by set and slug (`index`, `config`, `cli`, `build/plugins`, …). */
export const docsContent = new Map<DocsSet["id"], Map<string, Loader>>([
  ["latest", new Map(latestEnglish.map(([file, load]) => [docsSlug(file.slice(2)), load]))],
  ["v1", new Map(Object.entries(modules.v1).map(([file, load]) => [docsSlug(file.slice(2)), load]))],
])

/** Every content page's source file from the repository root, by set and slug, for its "Edit this page" link. */
export const docsFiles = new Map<DocsSet["id"], Map<string, string>>([
  [
    "latest",
    new Map(latestEnglish.map(([file]) => [docsSlug(file.slice(2)), `${latestDocs.content}/${file.slice(2)}`])),
  ],
  [
    "v1",
    new Map(Object.keys(modules.v1).map((file) => [docsSlug(file.slice(2)), `${v1Docs.content}/${file.slice(2)}`])),
  ],
])

/** The latest docs' translated pages, by language and English slug. */
export const docsTranslations = new Map<Locale, Map<string, Loader>>()
/** A translated page's source file, by language and slug, for its "Edit this page" link. */
export const docsTranslationFiles = new Map<Locale, Map<string, string>>()
const englishSlugs = docsContent.get("latest")!

for (const entry of latestTranslations) {
  // A translation whose English page is gone must not fail the build: warn, and don't serve it.
  if (!englishSlugs.has(entry.slug)) {
    console.warn(`docs: ignoring ${entry.path}: the latest docs have no ${entry.slug} page`)
    continue
  }
  const pages = docsTranslations.get(entry.locale) ?? new Map<string, Loader>()
  pages.set(entry.slug, entry.load)
  docsTranslations.set(entry.locale, pages)
  const files = docsTranslationFiles.get(entry.locale) ?? new Map<string, string>()
  files.set(entry.slug, `${latestDocs.content}/${entry.path}`)
  docsTranslationFiles.set(entry.locale, files)
}
