import { checksum } from "@opencode-ai/util/encode"
import { parseSmallMarkdown } from "@opencode-ai/ui/context/marked-base"
import DOMPurify from "dompurify"
import { MarkdownWorkerDisposedError, parseMarkdown } from "./markdown-worker"
import { localImagePath } from "./markdown-image"

export type MarkdownCacheEntry = {
  raw: string
  hash: string
  html: string
}

const max = 200
const cache = new Map<string, MarkdownCacheEntry>()
const pending = new Map<
  string,
  { raw: string; promise: Promise<MarkdownCacheEntry>; controller: AbortController; consumers: Set<symbol> }
>()
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

export async function preloadMarkdown(text: string, cacheKey: string, signal?: AbortSignal) {
  if (signal?.aborted) throw new MarkdownWorkerDisposedError()
  const block = { raw: text, src: text }
  const key = `${cacheKey}:0:full`
  if (getReadyMarkdown(block, key)) return
  await renderCachedMarkdown(block, key, signal)
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

export async function renderCachedMarkdown(block: { raw: string; src: string }, key?: string, signal?: AbortSignal) {
  if (signal?.aborted) throw new MarkdownWorkerDisposedError()
  const cached = key ? getCachedMarkdown(key) : undefined
  if (key && cached?.raw === block.raw) {
    pending.delete(key)
    touchCachedMarkdown(key, cached)
    return cached
  }
  const current = key ? pending.get(key) : undefined
  const job = current?.raw === block.raw ? current : startMarkdown(block, key)
  const consumer = Symbol()
  job.consumers.add(consumer)
  return new Promise<MarkdownCacheEntry>((resolve, reject) => {
    const release = () => {
      signal?.removeEventListener("abort", abort)
      // A disposed consumer must not cancel another consumer's shared parse.
      if (!job.consumers.delete(consumer) || job.consumers.size > 0) return
      job.controller.abort()
      if (key && pending.get(key) === job) pending.delete(key)
    }
    const abort = () => {
      release()
      reject(new MarkdownWorkerDisposedError())
    }
    signal?.addEventListener("abort", abort, { once: true })
    void job.promise.then(resolve, reject).finally(release)
  })
}

function startMarkdown(block: { raw: string; src: string }, key?: string) {
  const controller = new AbortController()
  const promise = parseMarkdown(block.src, controller.signal)
    .then((html) => {
      if (controller.signal.aborted) throw new MarkdownWorkerDisposedError()
      const hash = checksum(block.raw)
      const result = { raw: block.raw, hash: hash ?? "", html: sanitizeMarkdown(html) }
      if (key && hash && pending.get(key)?.promise === promise) touchCachedMarkdown(key, result)
      return result
    })
    .finally(() => {
      if (key && pending.get(key)?.promise === promise) pending.delete(key)
    })
  const job = { raw: block.raw, promise, controller, consumers: new Set<symbol>() }
  if (key) pending.set(key, job)
  return job
}
