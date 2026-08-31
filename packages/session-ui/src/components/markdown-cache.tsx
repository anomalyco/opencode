import { checksum } from "@opencode-ai/util/encode"
import { parseSmallMarkdown } from "@opencode-ai/ui/context/marked-base"
import DOMPurify from "dompurify"
import { parseMarkdown } from "./markdown-worker"
import { localImagePath } from "./markdown-image"

export type MarkdownCacheEntry = {
  raw: string
  hash: string
  html: string
}

const max = 200
const cache = new Map<string, MarkdownCacheEntry>()
const pending = new Map<string, { raw: string; promise: Promise<MarkdownCacheEntry> }>()
// Mermaid registers hooks on the shared instance that overwrite link attributes.
const purifier = typeof window !== "undefined" ? DOMPurify(window) : DOMPurify
const config = {
  USE_PROFILES: { html: true, mathMl: true },
  SANITIZE_NAMED_PROPS: true,
  FORBID_TAGS: ["style"],
  FORBID_CONTENTS: ["style", "script"],
  ADD_TAGS: ["svg", "path"],
  ADD_ATTR: ["d", "viewBox", "preserveAspectRatio", "xmlns", "target"],
}

if (typeof window !== "undefined" && purifier.isSupported) {
  purifier.addHook("beforeSanitizeAttributes", (node) => {
    if (!(node instanceof HTMLImageElement)) return
    // Local paths are not browser URLs. Keep them inert until the host reads them.
    node.removeAttribute("data-local-image")
    const path = localImagePath(node.getAttribute("src") ?? "")
    if (!path) return
    node.setAttribute("data-local-image", path)
    node.removeAttribute("src")
    node.removeAttribute("srcset")
  })
  purifier.addHook("afterSanitizeAttributes", (node: Element) => {
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
  if (!purifier.isSupported) return ""
  return purifier.sanitize(html, config)
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

export async function preloadMarkdown(text: string, cacheKey: string) {
  const block = { raw: text, src: text }
  const key = `${cacheKey}:0:full`
  if (getReadyMarkdown(block, key)) return
  await renderCachedMarkdown(block, key)
}

export function getReadyMarkdown(block: { raw: string; src: string }, key?: string) {
  const cached = key ? getCachedMarkdown(key) : undefined
  if (key && cached?.raw === block.raw) {
    pending.delete(key)
    touchCachedMarkdown(key, cached)
    return cached
  }
  if (!purifier.isSupported) return
  try {
    const html = parseSmallMarkdown(block.src)
    if (html === undefined) return
    const hash = checksum(block.raw)
    const result = { raw: block.raw, hash: hash ?? "", html: sanitizeMarkdown(html) }
    if (key && hash) {
      pending.delete(key)
      touchCachedMarkdown(key, result)
    }
    return result
  } catch {
    // Keep parser failures on the normal worker/escaped-text fallback path.
    return
  }
}

export async function renderCachedMarkdown(block: { raw: string; src: string }, key?: string) {
  const cached = key ? getCachedMarkdown(key) : undefined
  if (key && cached?.raw === block.raw) {
    pending.delete(key)
    touchCachedMarkdown(key, cached)
    return cached
  }
  const current = key ? pending.get(key) : undefined
  if (current?.raw === block.raw) return current.promise
  const promise = parseMarkdown(block.src)
    .then((html) => {
      const hash = checksum(block.raw)
      const result = { raw: block.raw, hash: hash ?? "", html: sanitizeMarkdown(html) }
      if (key && hash && pending.get(key)?.promise === promise) touchCachedMarkdown(key, result)
      return result
    })
    .finally(() => {
      if (key && pending.get(key)?.promise === promise) pending.delete(key)
    })
  if (key) pending.set(key, { raw: block.raw, promise })
  return promise
}
