import type { Component } from "solid-js"
import { docsSets, type DocsSet } from "./config"
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
// Globs take literal patterns, so each set's folder (config.ts `content`) is spelled out here.
const modules = {
  latest: import.meta.glob<DocsModule>("./**/*.mdx", { base: "./content" }),
  v1: import.meta.glob<DocsModule>("./**/*.mdx", { base: "./v1/content" }),
} satisfies Record<DocsSet["id"], unknown>

/** Every content page's loader, by set and slug (`index`, `config`, `cli`, `build/plugins`, …). */
export const docsContent = new Map(
  docsSets.map((set) => [
    set.id,
    new Map(Object.entries(modules[set.id]).map(([file, load]) => [docsSlug(file.slice(2)), load])),
  ]),
)

/** Every content page's source file from the repository root, by set and slug, for its "Edit this page" link. */
export const docsFiles = new Map(
  docsSets.map((set) => [
    set.id,
    new Map(Object.keys(modules[set.id]).map((file) => [docsSlug(file.slice(2)), `${set.content}/${file.slice(2)}`])),
  ]),
)
