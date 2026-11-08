import type { Component } from "solid-js"
import type { Frontmatter } from "./frontmatter"
import { docsSlug } from "./lib/navigation"
import type { DocsHeading } from "./rehype-headings"

/** A compiled content page (vite.ts): its content component, frontmatter, headings and Markdown twin. */
export type DocsModule = {
  default: Component<{ components?: Record<string, Component<any>> }>
  frontmatter: Frontmatter
  headings: DocsHeading[]
  markdown: string
}

// Loaded on demand: the Worker serves the prerendered pages, so it never evaluates these at start-up.
const modules = import.meta.glob<DocsModule>("./content/**/*.mdx")

/** Every content page's loader, by slug (`index`, `config`, `cli`, `build/plugins`, …). */
export const docsContent = new Map(
  Object.entries(modules).map(([file, load]) => [docsSlug(file.slice("./content/".length)), load]),
)

/** Every content page's source file under src/docs, by slug, for its "Edit this page" link. */
export const docsFiles = new Map(
  Object.keys(modules).map((file) => [docsSlug(file.slice("./content/".length)), file.slice(2)]),
)
