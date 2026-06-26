import { checksum } from "@opencode-ai/core/util/encode"
import DOMPurify from "dompurify"
import { project } from "./markdown-stream"

export type MarkdownCacheEntry = {
  raw: string
  hash: string
  html: string
}

const max = 200
const cache = new Map<string, MarkdownCacheEntry>()
const config = {
  USE_PROFILES: { html: true, mathMl: true },
  SANITIZE_NAMED_PROPS: true,
  FORBID_TAGS: ["style"],
  FORBID_CONTENTS: ["style", "script"],
  ADD_TAGS: ["svg", "path"],
  ADD_ATTR: ["d", "viewBox", "preserveAspectRatio", "xmlns", "target"],
}

if (typeof window !== "undefined" && DOMPurify.isSupported) {
  DOMPurify.addHook("afterSanitizeAttributes", (node: Element) => {
    if (!(node instanceof HTMLAnchorElement)) return
    if (node.target !== "_blank") return

    const rel = node.getAttribute("rel") ?? ""
    const set = new Set(rel.split(/\s+/).filter(Boolean))
    set.add("noopener")
    set.add("noreferrer")
    node.setAttribute("rel", Array.from(set).join(" "))
  })
}

export function sanitizeMarkdown(html: string) {
  if (!DOMPurify.isSupported) return ""
  return DOMPurify.sanitize(html, config)
}

export function getCachedMarkdown(key: string) {
  return cache.get(key)
}

export function touchCachedMarkdown(key: string, value: MarkdownCacheEntry) {
  cache.delete(key)
  cache.set(key, value)

  if (cache.size <= max) return

  const first = cache.keys().next().value
  if (!first) return
  cache.delete(first)
}

export async function preloadMarkdown(
  text: string,
  cacheKey: string,
  parser: { parse(text: string): string | Promise<string> },
) {
  await Promise.all(
    project(undefined, text, false).blocks.map(async (block, index) => {
      if (block.mode === "code") return
      const key = `${cacheKey}:${index}:${block.mode}`
      const cached = getCachedMarkdown(key)
      if (cached?.raw === block.raw) {
        touchCachedMarkdown(key, cached)
        return
      }
      const hash = checksum(block.raw)
      if (!hash) return
      touchCachedMarkdown(key, {
        raw: block.raw,
        hash,
        html: sanitizeMarkdown(await Promise.resolve(parser.parse(block.src))),
      })
    }),
  )
}
