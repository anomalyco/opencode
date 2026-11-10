/**
 * Session storage key: whether the reader has the Markdown view on, so a reload or the next page keeps
 * it. On its own, so the static pages' Markdown view (src/client/overlays/markdown.tsx) reads it
 * without use-markdown.ts's language context.
 */
export const markdownKey = "opencode-markdown-view"
