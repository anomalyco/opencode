import type { MarkdownCacheEntry } from "./markdown-cache"

/** A text revision whose blocks are shared by measure-ahead and painting. */
export type PreparedMarkdown = {
  text: string
  blocks: PreparedMarkdownBlock[]
}

export type PreparedMarkdownBlock =
  | (MarkdownCacheEntry & { mode: "full" | "live" })
  | { mode: "code"; raw: string; source: string; language: string; complete: boolean }
