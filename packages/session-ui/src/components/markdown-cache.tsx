import { abort } from "@opencode/util/abort"
import { checksum } from "@opencode/util/encode"
import { parseSmallMarkdown } from "@opencode/ui/context/marked-base"
import DOMPurify from "dompurify"
import { markdownWorkerDisposed, parseMarkdown } from "./markdown-worker"
import { localImagePath, localLinkPath } from "./markdown-image"
import { textDirection } from "./text-direction"

export type MarkdownCacheEntry = {
  raw: string
  src?: string
  hash: string
  html: string
}

const max = 200

const cache = new Map<string, MarkdownCacheEntry>()

const pending = new Map<
  string,
  { raw: string; promise: Promise<MarkdownCacheEntry>; controller: AbortController; consumers: Set<symbol> }
>()

// A private instance keeps this hook set separate from other DOMPurify users.
const purifier = typeof window !== "undefined" ? DOMPurify(window) : DOMPurify

const config = {
  USE_PROFILES: { html: true, mathMl: true },
  SANITIZE_NAMED_PROPS: true,
  FORBID_TAGS: ["style"],
  FORBID_CONTENTS: ["style", "script"],
  ADD_TAGS: ["svg", "path"],
  ADD_ATTR: ["d", "viewBox", "preserveAspectRatio", "xmlns", "target"],
}

// Code and math are isolated and always render left to right, so they must not
// decide the direction of the prose around them.
const codeSelector = "code, pre, script, style, math"

// Blocks own their paragraph direction. List containers place their markers and
// tables order their columns from it, so they are included with the text blocks.
const directionalBlocks = new Set([
  "P",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "LI",
  "DT",
  "DD",
  "UL",
  "OL",
  "BLOCKQUOTE",
  "TABLE",
  "CAPTION",
  "FIGCAPTION",
  "SUMMARY",
  "TD",
  "TH",
])

function blockText(node: Element) {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
  let text = ""

  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    if (current.parentElement?.closest(codeSelector)) continue

    text += current.nodeValue ?? ""
  }

  return text
}

// A list reads item by item, so its markers and indentation follow the language
// most of its items are written in instead of their combined text.
function blockDirection(node: Element) {
  if (!node.matches("ul, ol")) return textDirection(blockText(node))

  const directions = Array.from(node.children)
    .filter((child) => child.tagName === "LI")
    .map((child) => textDirection(blockText(child)))

  const rtl = directions.filter((direction) => direction === "rtl").length
  const ltr = directions.filter((direction) => direction === "ltr").length

  if (rtl === ltr) return directions[0]

  return rtl > ltr ? "rtl" : "ltr"
}

if (typeof window !== "undefined" && purifier.isSupported) {
  purifier.addHook("beforeSanitizeAttributes", (node) => {
    if (node instanceof HTMLAnchorElement) {
      // Local file links never navigate the document; the host decides how to open them.
      node.removeAttribute("data-local-link")
      const path = localLinkPath(node.getAttribute("href") ?? "")

      if (!path) return
      node.setAttribute("data-local-link", path)
      node.setAttribute("role", "link")
      node.setAttribute("tabindex", "0")
      node.removeAttribute("href")
      node.removeAttribute("target")

      return
    }

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
  purifier.addHook("afterSanitizeAttributes", (node: Element) => {
    if (!(node instanceof HTMLElement) || !directionalBlocks.has(node.tagName)) return

    const direction = blockDirection(node)

    if (direction) node.setAttribute("dir", direction)
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
  if (signal?.aborted) throw markdownWorkerDisposed
  const block = { raw: text, src: text }
  const key = `${cacheKey}:0:full`

  if (getReadyMarkdown(block, key)) return
  await renderCachedMarkdown(block, key, signal)
}

export function getReadyMarkdown(block: { raw: string; src: string }, key?: string) {
  const cached = key ? getCachedMarkdown(key) : undefined

  if (key && cached && (cached.src ?? cached.raw) === block.src) {
    pending.delete(key)
    touchCachedMarkdown(key, cached)

    return cached
  }

  if (!purifier.isSupported) return

  try {
    const html = parseSmallMarkdown(block.src)

    if (html === undefined) return
    const hash = checksum(block.src)
    const result = { raw: block.raw, src: block.src, hash: hash ?? "", html: sanitizeMarkdown(html) }

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
  if (signal?.aborted) throw markdownWorkerDisposed
  const cached = key ? getCachedMarkdown(key) : undefined

  if (key && cached && (cached.src ?? cached.raw) === block.src) {
    pending.delete(key)
    touchCachedMarkdown(key, cached)

    return cached
  }

  const current = key ? pending.get(key) : undefined
  const job = current?.raw === block.src ? current : startMarkdown(block, key)
  const consumer = Symbol()
  job.consumers.add(consumer)

  return new Promise<MarkdownCacheEntry>((resolve, reject) => {
    const release = () => {
      signal?.removeEventListener("abort", cancel)

      // A disposed consumer must not cancel another consumer's shared parse.
      if (!job.consumers.delete(consumer) || job.consumers.size > 0) return
      abort(job.controller)

      if (key && pending.get(key) === job) pending.delete(key)
    }

    const cancel = () => {
      release()
      reject(markdownWorkerDisposed)
    }

    signal?.addEventListener("abort", cancel, { once: true })
    void job.promise.then(resolve, reject).finally(release)
  })
}

function startMarkdown(block: { raw: string; src: string }, key?: string) {
  const controller = new AbortController()

  const promise = parseMarkdown(block.src, controller.signal)
    .then((html) => {
      if (controller.signal.aborted) throw markdownWorkerDisposed
      const hash = checksum(block.src)
      const result = { raw: block.raw, src: block.src, hash: hash ?? "", html: sanitizeMarkdown(html) }

      if (key && hash && pending.get(key)?.promise === promise) touchCachedMarkdown(key, result)

      return result
    })
    .finally(() => {
      if (key && pending.get(key)?.promise === promise) pending.delete(key)
    })

  const job = { raw: block.src, promise, controller, consumers: new Set<symbol>() }

  if (key) pending.set(key, job)

  return job
}
