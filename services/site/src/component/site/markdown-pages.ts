import { changelogEntryPageMarkdown, changelogMarkdown } from "~/lib/changelog-markdown"
import { domMarkdown } from "~/lib/dom-markdown"
import { homeMarkdown } from "~/lib/home-markdown"
import { extensionMarkdown, productMarkdown, productsMarkdown } from "~/lib/product-markdown"
import { MarkdownView } from "./markdown-view"

/**
 * The in-page Markdown view and the page Markdown only it needs, in one chunk that loads the first
 * time the view is wanted (use-markdown.ts). Pages whose Markdown is built from content they render
 * anyway (brand, press, font, legal) keep their generators.
 */
export const markdownPages = {
  MarkdownView,
  domMarkdown,
  homeMarkdown,
  productMarkdown,
  productsMarkdown,
  extensionMarkdown,
  changelogMarkdown,
  changelogEntryPageMarkdown,
}

export type MarkdownPages = typeof markdownPages
